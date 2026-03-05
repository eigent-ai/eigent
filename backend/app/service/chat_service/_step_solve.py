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

"""Main step_solve dispatcher and shared state."""

import asyncio
import logging
from dataclasses import dataclass, field
from enum import Enum

from camel.models import ModelProcessingError
from camel.tasks import Task
from fastapi import Request

from app.agent.listen_chat_agent import ListenChatAgent
from app.model.chat import Chat, sse_json
from app.service.chat_service.handlers import (
    handle_add_task,
    handle_budget_not_enough,
    handle_disconnect,
    handle_disconnect_cleanup,
    handle_end,
    handle_install_mcp,
    handle_new_agent,
    handle_passthrough_event,
    handle_pause,
    handle_remove_task,
    handle_resume,
    handle_skip_task,
    handle_start,
    handle_stop,
    handle_supplement,
    handle_task_state,
    handle_timeout,
    handle_update_task,
)
from app.service.chat_service.router import (
    handle_improve,
    handle_new_task_state,
)
from app.service.task import Action, TaskLock
from app.utils.server.sync_step import sync_step
from app.utils.workforce import Workforce

logger = logging.getLogger("chat_service")


class LoopControl(Enum):
    """Control flow for the main step_solve loop."""

    NORMAL = "normal"
    CONTINUE = "continue"
    BREAK = "break"


@dataclass
class StepSolveState:
    """Mutable state bag for step_solve's main loop."""

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


def _initialize_state(state: StepSolveState) -> None:
    """Initialize task_lock attributes."""
    if not hasattr(state.task_lock, "conversation_history"):
        state.task_lock.conversation_history = []
    if not hasattr(state.task_lock, "last_task_result"):
        state.task_lock.last_task_result = ""
    if not hasattr(state.task_lock, "question_agent"):
        state.task_lock.question_agent = None
    if not hasattr(state.task_lock, "summary_generated"):
        state.task_lock.summary_generated = False

    state.event_loop = asyncio.get_running_loop()


@sync_step
async def step_solve(options: Chat, request: Request, task_lock: TaskLock):
    """Main task execution loop. Called when POST /chat endpoint
    is hit to start a new chat session.

    Processes task queue, manages workforce lifecycle, and streams
    responses back to the client via SSE.

    Args:
        options (Chat): Chat configuration containing task details and
            model settings.
        request (Request): FastAPI request object for client connection
            management.
        task_lock (TaskLock): Shared task state and queue for the project.

    Yields:
        SSE formatted responses for task progress, errors, and results
    """
    state = StepSolveState(
        options=options,
        request=request,
        task_lock=task_lock,
    )
    _initialize_state(state)

    loop_iteration = 0

    logger.info("=" * 80)
    logger.info(
        "🚀 [LIFECYCLE] step_solve STARTED",
        extra={"project_id": options.project_id, "task_id": options.task_id},
    )
    logger.info("=" * 80)
    logger.debug(
        "Step solve options",
        extra={
            "task_id": options.task_id,
            "model_platform": options.model_platform,
        },
    )

    while True:
        loop_iteration += 1
        logger.debug(
            f"[LIFECYCLE] step_solve loop iteration #{loop_iteration}",
            extra={
                "project_id": options.project_id,
                "task_id": options.task_id,
            },
        )

        # Check for client disconnect
        if await request.is_disconnected():
            events, control = handle_disconnect(state)
            for event in events:
                yield event
            await handle_disconnect_cleanup(state)
            logger.info(
                "[LIFECYCLE] Breaking out of "
                "step_solve loop due to "
                "client disconnect"
            )
            break

        try:
            item = await task_lock.get_queue()
        except Exception as e:
            logger.error(
                "Error getting item from queue",
                extra={
                    "project_id": options.project_id,
                    "task_id": options.task_id,
                    "error": str(e),
                },
                exc_info=True,
            )
            # Continue waiting instead of breaking on queue error
            continue

        try:
            events: list[str] = []
            control = LoopControl.NORMAL

            if item.action == Action.improve or state.start_event_loop:
                events, control = await handle_improve(state, item)

            elif item.action == Action.update_task:
                events, control = handle_update_task(state, item)

            elif item.action == Action.add_task:
                events, control = handle_add_task(state, item)

            elif item.action == Action.remove_task:
                events, control = handle_remove_task(state, item)

            elif item.action == Action.skip_task:
                events, control = handle_skip_task(state, item)

            elif item.action == Action.start:
                events, control = handle_start(state, item)

            elif item.action == Action.task_state:
                events, control = handle_task_state(state, item)

            elif item.action == Action.new_task_state:
                events, control = await handle_new_task_state(state, item)

            elif item.action == Action.end:
                events, control = await handle_end(state, item)

            elif item.action == Action.supplement:
                events, control = handle_supplement(state, item)

            elif item.action == Action.budget_not_enough:
                events, control = handle_budget_not_enough(state, item)

            elif item.action == Action.stop:
                events, control = await handle_stop(state, item)

            elif item.action == Action.pause:
                events, control = handle_pause(state, item)

            elif item.action == Action.resume:
                events, control = handle_resume(state, item)

            elif item.action == Action.new_agent:
                events, control = await handle_new_agent(state, item)

            elif item.action == Action.timeout:
                events, control = handle_timeout(state, item)

            elif item.action == Action.install_mcp:
                events, control = handle_install_mcp(state, item)

            else:
                # Try passthrough events
                passthrough = handle_passthrough_event(item)
                if passthrough is not None:
                    events = [passthrough]
                else:
                    logger.warning(f"Unknown action: {item.action}")

            # Yield all events
            for event in events:
                yield event

            # Handle loop control
            if control == LoopControl.BREAK:
                break
            elif control == LoopControl.CONTINUE:
                continue

        except ModelProcessingError as e:
            if "Budget has been exceeded" in str(e):
                logger.warning(
                    "Budget exceeded for task "
                    f"{options.task_id}, action: "
                    f"{item.action}"
                )
                if state.workforce is not None:
                    state.workforce.pause()
                yield sse_json(
                    Action.budget_not_enough,
                    {"message": "budget not enouth"},
                )
            else:
                logger.error(
                    "ModelProcessingError for task "
                    f"{options.task_id}, action "
                    f"{item.action}: {e}",
                    exc_info=True,
                )
                yield sse_json("error", {"message": str(e)})
                if state.workforce is not None and state.workforce._running:
                    state.workforce.stop()
        except Exception as e:
            logger.error(
                "Unhandled exception for task "
                f"{options.task_id}, action "
                f"{item.action}: {e}",
                exc_info=True,
            )
            yield sse_json("error", {"message": str(e)})
            # Continue processing other items instead of breaking
