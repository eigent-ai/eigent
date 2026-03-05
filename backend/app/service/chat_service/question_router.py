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

from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path

from camel.tasks import Task

from app.agent.factory.question_confirm import question_confirm, simple_answer
from app.agent.factory.task_summary import (
    get_task_result_with_optional_summary,
    summary_task,
)
from app.model.chat import Status, sse_json
from app.service.chat_service.decomposition import (
    create_stream_callbacks,
    handle_improve_complex_task,
)
from app.service.chat_service.handlers import _extract_task_content
from app.service.chat_service.lifecycle import tree_sub_tasks
from app.service.chat_service.types import LoopControl, StepSolveState
from app.service.task import (
    ActionDecomposeProgressData,
    ActionImproveData,
    set_current_task_id,
)
from app.utils.context import (
    build_conversation_context,
    check_conversation_history_length,
)
from app.utils.file_utils import get_working_directory

logger = logging.getLogger(__name__)


def _check_context_too_long(state: StepSolveState) -> str | None:
    """Return a context_too_long SSE event if history is exceeded, else None."""
    is_exceeded, total_length = check_conversation_history_length(
        state.task_lock
    )
    if not is_exceeded:
        return None
    logger.error(
        f"Conversation history too long ({total_length} chars) for {state.options.project_id}"
    )
    return sse_json(
        "context_too_long",
        {
            "message": "The conversation history is too long. Please create a new project to continue.",
            "current_length": total_length,
            "max_length": 100000,
        },
    )


def _summary_fallback(task_content: str) -> str:
    """Build a fallback summary string when LLM summary fails."""
    if len(task_content) > 100:
        return f"Follow-up Task|{task_content[:97]}..."
    return f"Follow-up Task|{task_content}"


async def _generate_simple_answer(state: StepSolveState, question: str) -> str:
    """Generate a simple answer, returning a fallback on error."""
    try:
        return await simple_answer(question, state.options, state.task_lock)
    except Exception as e:
        logger.error(f"Error generating simple answer: {e}")
        return "I encountered an error while processing your question."


async def handle_improve(
    state: StepSolveState, item
) -> tuple[list[str], LoopControl]:
    """Top-level router for Action.improve: extract question,
    check history, classify simple vs complex, delegate."""

    events: list[str] = []

    if state.start_event_loop is True:
        question = state.options.question
        attaches_to_use = state.options.attaches
        logger.info(f"Action.improve (initial): '{question[:100]}...'")
        state.start_event_loop = False
    else:
        assert isinstance(item, ActionImproveData)
        question = item.data.question
        attaches_to_use = (
            item.data.attaches
            if item.data.attaches
            else state.options.attaches
        )
        logger.info(f"Action.improve (follow-up): '{question[:100]}...'")

    ctx_event = _check_context_too_long(state)
    if ctx_event is not None:
        return [ctx_event], LoopControl.CONTINUE

    # Determine task complexity
    if len(attaches_to_use) > 0:
        is_complex_task = True
        logger.info("Has attachments, treating as complex task")
    else:
        is_complex_task = await question_confirm(
            question, state.options, state.task_lock
        )
        logger.info(f"question_confirm result: is_complex={is_complex_task}")

    if not is_complex_task:
        simple_events, control = await handle_improve_simple_task(
            state, question
        )
        events.extend(simple_events)
        return events, control
    else:
        complex_events, control = await handle_improve_complex_task(
            state, item, question, attaches_to_use
        )
        events.extend(complex_events)
        return events, control


async def handle_improve_simple_task(
    state: StepSolveState, question: str
) -> tuple[list[str], LoopControl]:
    """Handle simple question: direct LLM answer, folder cleanup."""

    answer_content = await _generate_simple_answer(state, question)

    state.task_lock.add_conversation("assistant", answer_content)
    events = [
        sse_json(
            "wait_confirm",
            {"content": answer_content, "question": question},
        )
    ]

    # Clean up empty folder if it was created for this task
    if (
        hasattr(state.task_lock, "new_folder_path")
        and state.task_lock.new_folder_path
    ):
        try:
            folder_path = Path(state.task_lock.new_folder_path)
            if folder_path.exists() and folder_path.is_dir():
                if not any(folder_path.iterdir()):
                    folder_path.rmdir()
                    logger.info(f"Cleaned up empty folder: {folder_path}")
                    project_folder = folder_path.parent
                    if project_folder.exists() and not any(
                        project_folder.iterdir()
                    ):
                        project_folder.rmdir()
                        logger.info(
                            f"Cleaned up empty project folder: {project_folder}"
                        )
            state.task_lock.new_folder_path = None
        except Exception as e:
            logger.error(f"Error cleaning up folder: {e}")

    return events, LoopControl.CONTINUE


async def handle_new_task_state(
    state: StepSolveState, item
) -> tuple[list[str], LoopControl]:
    """Handle Action.new_task_state: multi-turn question handling."""

    events: list[str] = []
    new_task_id = item.data.get("task_id", "unknown")
    logger.info(
        f"NEW_TASK_STATE (multi-turn): task_id={new_task_id}, "
        f"state={item.data.get('state', 'unknown')}"
    )

    if state.camel_task is None:
        logger.error(
            f"NEW_TASK_STATE with camel_task=None for {state.options.project_id}"
        )
        events.append(
            sse_json(
                "error",
                {
                    "message": "Cannot process new task state: current task not initialized."
                },
            )
        )
        return events, LoopControl.CONTINUE

    old_task_content = _extract_task_content(state)
    old_task_result = await get_task_result_with_optional_summary(
        state.camel_task, state.options
    )

    state.task_lock.add_conversation(
        "task_result",
        {
            "task_content": old_task_content,
            "task_result": old_task_result,
            "working_directory": get_working_directory(
                state.options, state.task_lock
            ),
        },
    )

    new_task_content = item.data.get("content", "")

    if new_task_content:
        task_id = item.data.get("task_id", f"{int(time.time() * 1000)}-multi")
        new_camel_task = Task(content=new_task_content, id=task_id)
        if (
            hasattr(state.camel_task, "additional_info")
            and state.camel_task.additional_info
        ):
            new_camel_task.additional_info = state.camel_task.additional_info
        state.camel_task = new_camel_task

    events.append(sse_json("end", old_task_result))
    events.append(sse_json("new_task_state", item.data))
    events.append(
        sse_json("remove_task", {"task_id": item.data.get("task_id")})
    )

    if state.workforce is not None and new_task_content:
        state.task_lock.status = Status.confirming
        state.workforce.pause()
        logger.info(
            f"Multi-turn: workforce paused, state={state.workforce._state.name}"
        )

        try:
            is_multi_turn_complex = await question_confirm(
                new_task_content, state.options, state.task_lock
            )
            logger.info(
                f"Multi-turn question_confirm: is_complex={is_multi_turn_complex}"
            )

            if not is_multi_turn_complex:
                answer_content = await _generate_simple_answer(
                    state, new_task_content
                )
                state.task_lock.add_conversation("assistant", answer_content)
                events.append(
                    sse_json(
                        "wait_confirm",
                        {
                            "content": answer_content,
                            "question": new_task_content,
                        },
                    )
                )
                state.workforce.resume()
                return events, LoopControl.CONTINUE

            set_current_task_id(state.options.project_id, task_id)
            events.append(
                sse_json("confirmed", {"question": new_task_content})
            )
            state.task_lock.status = Status.confirmed

            context_for_multi_turn = build_conversation_context(
                state.task_lock
            )

            on_stream_batch, on_stream_text, stream_state = (
                create_stream_callbacks(state)
            )

            wf = state.workforce
            new_sub_tasks = await wf.handle_decompose_append_task(
                state.camel_task,
                reset=False,
                coordinator_context=context_for_multi_turn,
                on_stream_batch=on_stream_batch,
                on_stream_text=on_stream_text,
            )
            if stream_state["subtasks"]:
                new_sub_tasks = stream_state["subtasks"]
            logger.info(
                f"Multi-turn: task decomposed into {len(new_sub_tasks)} subtasks"
            )

            try:
                new_summary_content = await asyncio.wait_for(
                    summary_task(state.camel_task, state.options),
                    timeout=10,
                )
                logger.info(
                    f"Generated LLM summary for multi-turn task ({state.options.project_id})"
                )
            except (TimeoutError, Exception) as e:
                level = "warning" if isinstance(e, TimeoutError) else "error"
                getattr(logger, level)(
                    f"Multi-turn summary_task failed: {e}",
                    extra={"project_id": state.options.project_id},
                )
                new_summary_content = _summary_fallback(new_task_content)

            final_payload = {
                "project_id": state.options.project_id,
                "task_id": state.options.task_id,
                "sub_tasks": tree_sub_tasks(state.camel_task.subtasks),
                "delta_sub_tasks": tree_sub_tasks(new_sub_tasks),
                "is_final": True,
                "summary_task": new_summary_content,
            }
            await state.task_lock.put_queue(
                ActionDecomposeProgressData(data=final_payload)
            )

            state.sub_tasks = new_sub_tasks
            state.summary_task_content = new_summary_content

        except Exception as e:
            logger.error(
                f"Failed to process multi-turn task: {e}", exc_info=True
            )
            events.append(
                sse_json("error", {"message": f"Failed to process task: {e}"})
            )
    else:
        if state.workforce is None:
            logger.warning("Multi-turn: workforce is None")
        if not new_task_content:
            logger.warning("Multi-turn: no new task content provided")

    return events, LoopControl.NORMAL
