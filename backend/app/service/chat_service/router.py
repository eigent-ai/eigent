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

"""Question classification and routing: simple vs complex."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import TYPE_CHECKING

from camel.tasks import Task

from app.agent.factory.question_confirm import question_confirm
from app.agent.factory.task_summary import (
    get_task_result_with_optional_summary,
    summary_task,
    task_summary_agent,
)
from app.model.chat import Status, sse_json
from app.service.chat_service.decomposition import (
    create_stream_callbacks,
    handle_improve_complex_task,
)
from app.service.chat_service.lifecycle import tree_sub_tasks
from app.service.task import (
    ActionDecomposeProgressData,
    ActionImproveData,
    set_current_task_id,
)
from app.utils.context import (
    build_context_for_workforce,
    build_conversation_context,
    check_conversation_history_length,
)
from app.utils.file_utils import get_working_directory

if TYPE_CHECKING:
    from app.service.chat_service._step_solve import (
        LoopControl,
        StepSolveState,
    )

logger = logging.getLogger("chat_service")


async def handle_improve(
    state: StepSolveState, item
) -> tuple[list[str], LoopControl]:
    """Top-level router for Action.improve: extract question,
    check history, classify simple vs complex, delegate."""
    from app.service.chat_service._step_solve import LoopControl

    events = []
    logger.info("=" * 80)
    logger.info(
        "[NEW-QUESTION] Action.improve received or start_event_loop",
        extra={
            "project_id": state.options.project_id,
            "start_event_loop": state.start_event_loop,
        },
    )
    wf_state = (
        "None"
        if state.workforce is None
        else f"exists(id={id(state.workforce)})"
    )
    logger.info(
        f"[NEW-QUESTION] Current workforce state: workforce={wf_state}"
    )
    ct_state = (
        "None"
        if state.camel_task is None
        else f"exists(id={state.camel_task.id})"
    )
    logger.info(
        f"[NEW-QUESTION] Current camel_task state: camel_task={ct_state}"
    )
    logger.info("=" * 80)

    if state.start_event_loop is True:
        question = state.options.question
        attaches_to_use = state.options.attaches
        logger.info(
            "[NEW-QUESTION] Initial question"
            " from options.question: "
            f"'{question[:100]}...'"
        )
        state.start_event_loop = False
    else:
        assert isinstance(item, ActionImproveData)
        question = item.data.question
        attaches_to_use = (
            item.data.attaches
            if item.data.attaches
            else state.options.attaches
        )
        logger.info(
            "[NEW-QUESTION] Follow-up "
            "question from "
            "ActionImproveData: "
            f"'{question[:100]}...'"
        )

    is_exceeded, total_length = check_conversation_history_length(
        state.task_lock
    )
    if is_exceeded:
        logger.error(
            "Conversation history too long",
            extra={
                "project_id": state.options.project_id,
                "current_length": total_length,
                "max_length": 100000,
            },
        )
        ctx_msg = (
            "The conversation history "
            "is too long. Please create"
            " a new project to continue."
        )
        events.append(
            sse_json(
                "context_too_long",
                {
                    "message": ctx_msg,
                    "current_length": total_length,
                    "max_length": 100000,
                },
            )
        )
        return events, LoopControl.CONTINUE

    # Determine task complexity
    is_complex_task: bool
    if len(attaches_to_use) > 0:
        is_complex_task = True
        logger.info("[NEW-QUESTION] Has attachments, treating as complex task")
    else:
        is_complex_task = await question_confirm(
            state.question_agent, question, state.task_lock
        )
        logger.info(
            "[NEW-QUESTION] question_confirm"
            " result: is_complex="
            f"{is_complex_task}"
        )

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
    from app.service.chat_service._step_solve import LoopControl

    events = []
    logger.info(
        "[NEW-QUESTION] Simple question"
        ", providing direct answer "
        "without workforce"
    )
    conv_ctx = build_conversation_context(
        state.task_lock, header="=== Previous Conversation ==="
    )
    simple_answer_prompt = (
        f"{conv_ctx}"
        f"User Query: {question}\n\n"
        "Provide a direct, helpful "
        "answer to this simple "
        "question."
    )

    try:
        simple_resp = state.question_agent.step(simple_answer_prompt)
        if simple_resp and simple_resp.msgs:
            answer_content = simple_resp.msgs[0].content
        else:
            answer_content = (
                "I understand your "
                "question, but I'm "
                "having trouble "
                "generating a response "
                "right now."
            )

        state.task_lock.add_conversation("assistant", answer_content)

        events.append(
            sse_json(
                "wait_confirm",
                {"content": answer_content, "question": question},
            )
        )
    except Exception as e:
        logger.error(f"Error generating simple answer: {e}")
        events.append(
            sse_json(
                "wait_confirm",
                {
                    "content": "I encountered an error"
                    " while processing "
                    "your question.",
                    "question": question,
                },
            )
        )

    # Clean up empty folder if it was created for this task
    if (
        hasattr(state.task_lock, "new_folder_path")
        and state.task_lock.new_folder_path
    ):
        try:
            folder_path = Path(state.task_lock.new_folder_path)
            if folder_path.exists() and folder_path.is_dir():
                # Check if folder is empty
                if not any(folder_path.iterdir()):
                    folder_path.rmdir()
                    logger.info(f"Cleaned up empty folder: {folder_path}")
                    # Also clean up parent project folder if empty
                    project_folder = folder_path.parent
                    if project_folder.exists() and not any(
                        project_folder.iterdir()
                    ):
                        project_folder.rmdir()
                        logger.info(
                            "Cleaned up "
                            "empty project"
                            " folder: "
                            f"{project_folder}"
                        )
                else:
                    logger.info(f"Folder not empty, keeping: {folder_path}")
            # Reset the folder path
            state.task_lock.new_folder_path = None
        except Exception as e:
            logger.error(f"Error cleaning up folder: {e}")

    return events, LoopControl.CONTINUE


async def handle_new_task_state(
    state: StepSolveState, item
) -> tuple[list[str], LoopControl]:
    """Handle Action.new_task_state: multi-turn question handling."""
    from app.service.chat_service._step_solve import LoopControl

    events = []
    logger.info("=" * 80)
    logger.info(
        "[LIFECYCLE] NEW_TASK_STATE action received (Multi-turn)",
        extra={"project_id": state.options.project_id},
    )
    logger.info("=" * 80)

    # Log new task state details
    new_task_id = item.data.get("task_id", "unknown")
    new_task_state = item.data.get("state", "unknown")
    logger.info(
        "[LIFECYCLE] New task details"
        f": task_id={new_task_id}, "
        f"state={new_task_state}"
    )

    if state.camel_task is None:
        logger.error(
            "NEW_TASK_STATE action "
            "received but camel_task "
            "is None for project "
            f"{state.options.project_id}, "
            f"task {new_task_id}"
        )
        events.append(
            sse_json(
                "error",
                {
                    "message": "Cannot process new task "
                    "state: current task not "
                    "initialized."
                },
            )
        )
        return events, LoopControl.CONTINUE

    old_task_content: str = state.camel_task.content
    old_task_result: str = await get_task_result_with_optional_summary(
        state.camel_task, state.options
    )

    old_task_content_clean: str = old_task_content
    if "=== CURRENT TASK ===" in old_task_content_clean:
        old_task_content_clean = old_task_content_clean.split(
            "=== CURRENT TASK ==="
        )[-1].strip()

    state.task_lock.add_conversation(
        "task_result",
        {
            "task_content": old_task_content_clean,
            "task_result": old_task_result,
            "working_directory": get_working_directory(
                state.options, state.task_lock
            ),
        },
    )

    new_task_content = item.data.get("content", "")

    if new_task_content:
        import time

        task_id = item.data.get("task_id", f"{int(time.time() * 1000)}-multi")
        new_camel_task = Task(content=new_task_content, id=task_id)
        if (
            hasattr(state.camel_task, "additional_info")
            and state.camel_task.additional_info
        ):
            new_camel_task.additional_info = state.camel_task.additional_info
        state.camel_task = new_camel_task

    # Now trigger end of previous task using stored result
    events.append(sse_json("end", old_task_result))

    # Always yield new_task_state first - this is not optional
    events.append(sse_json("new_task_state", item.data))
    # Trigger Queue Removal
    events.append(
        sse_json("remove_task", {"task_id": item.data.get("task_id")})
    )

    # Then handle multi-turn processing
    if state.workforce is not None and new_task_content:
        logger.info(
            "[LIFECYCLE] Multi-turn: "
            "workforce exists "
            f"(id={id(state.workforce)}), "
            "pausing for question "
            "confirmation"
        )
        state.task_lock.status = Status.confirming
        state.workforce.pause()
        logger.info(
            "[LIFECYCLE] Multi-turn: "
            "workforce paused, state="
            f"{state.workforce._state.name}"
        )

        try:
            logger.info(
                "[LIFECYCLE] Multi-turn: calling question_confirm for new task"
            )
            is_multi_turn_complex = await question_confirm(
                state.question_agent, new_task_content, state.task_lock
            )
            logger.info(
                "[LIFECYCLE] Multi-turn: "
                "question_confirm result:"
                " is_complex="
                f"{is_multi_turn_complex}"
            )

            if not is_multi_turn_complex:
                logger.info(
                    "[LIFECYCLE] Multi-turn: "
                    "task is simple, providing"
                    " direct answer without "
                    "workforce"
                )
                conv_ctx = build_conversation_context(
                    state.task_lock,
                    header="=== Previous Conversation ===",
                )
                simple_answer_prompt = (
                    f"{conv_ctx}"
                    "User Query: "
                    f"{new_task_content}"
                    "\n\nProvide a direct, "
                    "helpful answer to this "
                    "simple question."
                )

                try:
                    simple_resp = state.question_agent.step(
                        simple_answer_prompt
                    )
                    if simple_resp and simple_resp.msgs:
                        answer_content = simple_resp.msgs[0].content
                    else:
                        answer_content = (
                            "I understand your "
                            "question, but I'm "
                            "having trouble "
                            "generating a response"
                            " right now."
                        )

                    state.task_lock.add_conversation(
                        "assistant", answer_content
                    )

                    events.append(
                        sse_json(
                            "wait_confirm",
                            {
                                "content": answer_content,
                                "question": new_task_content,
                            },
                        )
                    )
                except Exception as e:
                    logger.error(
                        f"Error generating simple answer in multi-turn: {e}"
                    )
                    events.append(
                        sse_json(
                            "wait_confirm",
                            {
                                "content": "I encountered an error "
                                "while processing your "
                                "question.",
                                "question": new_task_content,
                            },
                        )
                    )

                logger.info(
                    "[LIFECYCLE] Multi-turn: "
                    "simple answer provided, "
                    "resuming workforce"
                )
                state.workforce.resume()
                logger.info(
                    "[LIFECYCLE] Multi-turn: "
                    "workforce resumed, "
                    "continuing to next "
                    "iteration"
                )
                return events, LoopControl.CONTINUE

            # Update the sync_step with new task_id
            logger.info(
                "[LIFECYCLE] Multi-turn: "
                "task is complex, setting "
                f"new task_id={task_id}"
            )
            set_current_task_id(state.options.project_id, task_id)

            events.append(
                sse_json("confirmed", {"question": new_task_content})
            )
            state.task_lock.status = Status.confirmed

            logger.info(
                "[LIFECYCLE] Multi-turn: building context for workforce"
            )
            context_for_multi_turn = build_context_for_workforce(
                state.task_lock, state.options
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
            n = len(new_sub_tasks)
            logger.info(
                f"[LIFECYCLE] Multi-turn: task decomposed into {n} subtasks"
            )

            # Generate proper LLM summary for multi-turn tasks
            try:
                multi_turn_summary_agent = task_summary_agent(state.options)
                new_summary_content = await asyncio.wait_for(
                    summary_task(multi_turn_summary_agent, state.camel_task),
                    timeout=10,
                )
                logger.info(
                    "Generated LLM summary for multi-turn task",
                    extra={"project_id": state.options.project_id},
                )
            except TimeoutError:
                logger.warning(
                    "Multi-turn summary_task timeout",
                    extra={
                        "project_id": state.options.project_id,
                        "task_id": task_id,
                    },
                )
                task_content_for_summary = new_task_content
                tc = task_content_for_summary
                if len(tc) > 100:
                    new_summary_content = f"Follow-up Task|{tc[:97]}..."
                else:
                    new_summary_content = f"Follow-up Task|{tc}"
            except Exception as e:
                logger.error(f"Error generating multi-turn task summary: {e}")
                task_content_for_summary = new_task_content
                tc = task_content_for_summary
                if len(tc) > 100:
                    new_summary_content = f"Follow-up Task|{tc[:97]}..."
                else:
                    new_summary_content = f"Follow-up Task|{tc}"

            # Emit final subtasks once when decomposition is complete
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

            # Update the context with new task data
            state.sub_tasks = new_sub_tasks
            state.summary_task_content = new_summary_content

        except Exception as e:
            import traceback

            logger.error(f"[TRACE] Traceback: {traceback.format_exc()}")
            events.append(
                sse_json(
                    "error",
                    {"message": f"Failed to process task: {str(e)}"},
                )
            )
    else:
        if state.workforce is None:
            logger.warning(
                "[TRACE] Workforce is None - this might be the issue"
            )
        if not new_task_content:
            logger.warning("[TRACE] No new task content provided")

    return events, LoopControl.NORMAL
