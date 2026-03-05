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
import logging
from pathlib import Path
from typing import Any

from camel.tasks import Task

from app.agent.factory.task_summary import summary_task
from app.model.chat import Status, sse_json
from app.service.chat_service.lifecycle import (
    construct_workforce,
    format_agent_description,
    new_agent_model,
    tree_sub_tasks,
)
from app.service.chat_service.types import LoopControl, StepSolveState
from app.service.task import (
    ActionDecomposeProgressData,
    ActionDecomposeTextData,
    set_current_task_id,
)
from app.utils.context import build_conversation_context

logger = logging.getLogger(__name__)


def create_stream_callbacks(
    state: StepSolveState,
) -> tuple[Any, Any, dict]:
    """Create streaming callbacks for decomposition.

    Returns:
        (on_stream_batch, on_stream_text, stream_state) tuple.
    """
    stream_state = {
        "subtasks": [],
        "seen_ids": set(),
        "last_content": "",
    }

    def on_stream_batch(new_tasks: list[Task], is_final: bool = False):
        fresh_tasks = [
            t for t in new_tasks if t.id not in stream_state["seen_ids"]
        ]
        for t in fresh_tasks:
            stream_state["seen_ids"].add(t.id)
        stream_state["subtasks"].extend(fresh_tasks)

    def on_stream_text(chunk):
        try:
            accumulated_content = (
                chunk.msg.content
                if hasattr(chunk, "msg") and chunk.msg
                else str(chunk)
            )
            last_content = stream_state["last_content"]

            # Calculate delta: new content not in the previous chunk
            if accumulated_content.startswith(last_content):
                delta_content = accumulated_content[len(last_content) :]
            else:
                delta_content = accumulated_content

            stream_state["last_content"] = accumulated_content

            if delta_content:
                asyncio.run_coroutine_threadsafe(
                    state.task_lock.put_queue(
                        ActionDecomposeTextData(
                            data={
                                "project_id": state.options.project_id,
                                "task_id": state.options.task_id,
                                "content": delta_content,
                            }
                        )
                    ),
                    state.event_loop,
                )
        except Exception as e:
            logger.warning(f"Failed to stream decomposition text: {e}")

    return on_stream_batch, on_stream_text, stream_state


async def run_decomposition_task(
    state: StepSolveState,
    context_for_coordinator: str,
    on_stream_batch,
    on_stream_text,
    stream_state: dict,
) -> None:
    """Run task decomposition in background, generating summary and
    streaming progress."""
    try:
        sub_tasks = await asyncio.to_thread(
            state.workforce.eigent_make_sub_tasks,
            state.camel_task,
            context_for_coordinator,
            on_stream_batch,
            on_stream_text,
        )

        if stream_state["subtasks"]:
            sub_tasks = stream_state["subtasks"]
        logger.info(f"Task decomposed into {len(sub_tasks)} subtasks")
        try:
            state.task_lock.decompose_sub_tasks = sub_tasks
        except Exception:
            pass

        # Generate task summary
        try:
            new_summary = await asyncio.wait_for(
                summary_task(state.camel_task, state.options),
                timeout=10,
            )
            state.task_lock.summary_generated = True
        except TimeoutError:
            logger.warning(
                "summary_task timeout",
                extra={
                    "project_id": state.options.project_id,
                    "task_id": state.options.task_id,
                },
            )
            state.task_lock.summary_generated = True
            content_preview = (
                state.camel_task.content
                if hasattr(state.camel_task, "content")
                else ""
            )
            if content_preview is None:
                content_preview = ""
            if len(content_preview) > 80:
                cp = content_preview[:80]
                new_summary = cp + "..."
            else:
                new_summary = content_preview
            new_summary = f"Task|{new_summary}"
        except Exception:
            state.task_lock.summary_generated = True
            content_preview = (
                state.camel_task.content
                if hasattr(state.camel_task, "content")
                else ""
            )
            if content_preview is None:
                content_preview = ""
            if len(content_preview) > 80:
                cp = content_preview[:80]
                new_summary = cp + "..."
            else:
                new_summary = content_preview
            new_summary = f"Task|{new_summary}"

        state.summary_task_content = new_summary
        try:
            state.task_lock.summary_task_content = new_summary
        except Exception:
            pass

        payload = {
            "project_id": state.options.project_id,
            "task_id": state.options.task_id,
            "sub_tasks": tree_sub_tasks(state.camel_task.subtasks),
            "delta_sub_tasks": tree_sub_tasks(sub_tasks),
            "is_final": True,
            "summary_task": new_summary,
        }
        await state.task_lock.put_queue(
            ActionDecomposeProgressData(data=payload)
        )
    except Exception as e:
        logger.error(
            f"Error in background decomposition: {e}",
            exc_info=True,
        )


async def handle_improve_complex_task(
    state: StepSolveState,
    item,
    question: str,
    attaches_to_use: list[str],
) -> tuple[list[str], LoopControl]:
    """Handle complex task: create workforce, setup camel_task,
    kick off decomposition."""
    events = []
    logger.info(
        "[NEW-QUESTION] Complex task, creating workforce and decomposing"
    )
    # Update the sync_step with new task_id
    if hasattr(item, "new_task_id") and item.new_task_id:
        set_current_task_id(state.options.project_id, item.new_task_id)
        state.task_lock.summary_generated = False

    events.append(sse_json("confirmed", {"question": question}))

    context_for_coordinator = build_conversation_context(state.task_lock)

    # Check if workforce exists - reuse it; otherwise create new one
    if state.workforce is not None:
        logger.debug(
            "[NEW-QUESTION] Reusing "
            "existing workforce "
            f"(id={id(state.workforce)})"
        )
    else:
        logger.info("[NEW-QUESTION] Creating NEW workforce instance")
        (state.workforce, state.mcp) = await construct_workforce(state.options)
        for new_agent in state.options.new_agents:
            state.workforce.add_single_agent_worker(
                format_agent_description(new_agent),
                await new_agent_model(new_agent, state.options),
            )
    state.task_lock.status = Status.confirmed

    # Create camel_task for the question
    clean_task_content = question + state.options.summary_prompt
    state.camel_task = Task(
        content=clean_task_content, id=state.options.task_id
    )
    if len(attaches_to_use) > 0:
        state.camel_task.additional_info = {
            Path(file_path).name: file_path for file_path in attaches_to_use
        }

    # Stream decomposition in background
    on_stream_batch, on_stream_text, stream_state = create_stream_callbacks(
        state
    )

    bg_task = asyncio.create_task(
        run_decomposition_task(
            state,
            context_for_coordinator,
            on_stream_batch,
            on_stream_text,
            stream_state,
        )
    )
    state.task_lock.add_background_task(bg_task)

    return events, LoopControl.NORMAL
