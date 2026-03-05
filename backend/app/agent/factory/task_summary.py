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

import logging

from camel.tasks import Task

from app.agent.agent_model import agent_model
from app.agent.prompt import (
    SUBTASKS_SUMMARY_PROMPT,
    TASK_SUMMARY_PROMPT,
    TASK_SUMMARY_SYS_PROMPT,
)
from app.model.chat import Chat

logger = logging.getLogger(__name__)


def _create_summary_agent(options: Chat):
    """Create a task summary agent."""
    return agent_model(
        "task_summary_agent",
        TASK_SUMMARY_SYS_PROMPT,
        options,
    )


async def summary_task(task: Task, options: Chat) -> str:
    """Generate a short name and summary for a task."""
    agent = _create_summary_agent(options)
    prompt = TASK_SUMMARY_PROMPT.format(task_string=task.to_string())
    logger.debug("Generating task summary", extra={"task_id": task.id})
    try:
        res = agent.step(prompt)
        summary = res.msgs[0].content
        logger.info("Task summary generated", extra={"summary": summary})
        return summary
    except Exception as e:
        logger.error(
            "Error generating task summary",
            extra={"error": str(e)},
            exc_info=True,
        )
        raise


async def summary_subtasks_result(task: Task, options: Chat) -> str:
    """Summarize the aggregated results from all subtasks.

    Args:
        task: The main task containing subtasks and their aggregated results
        options: Chat options for creating the summary agent

    Returns:
        A concise summary of all subtask results
    """
    agent = _create_summary_agent(options)

    subtasks_info = ""
    for i, subtask in enumerate(task.subtasks, 1):
        subtasks_info += f"\n**Subtask {i}**\n"
        subtasks_info += f"Description: {subtask.content}\n"
        subtasks_info += f"Result: {subtask.result or 'No result'}\n"
        subtasks_info += "---\n"

    prompt = SUBTASKS_SUMMARY_PROMPT.format(
        task_content=task.content, subtasks_info=subtasks_info
    )

    res = agent.step(prompt)
    summary = res.msgs[0].content

    logger.info(
        "Generated subtasks summary for "
        f"task {task.id} with "
        f"{len(task.subtasks)} subtasks"
    )

    return summary


async def get_task_result_with_optional_summary(
    task: Task, options: Chat
) -> str:
    """Get the task result, with LLM summary if there are multiple subtasks.

    Args:
        task: The task to get result from
        options: Chat options for creating summary agent

    Returns:
        The task result (summarized if multiple subtasks, raw otherwise)
    """
    result = str(task.result or "")

    if task.subtasks and len(task.subtasks) > 1:
        logger.info(
            f"Task {task.id} has "
            f"{len(task.subtasks)} subtasks, "
            "generating summary"
        )
        try:
            summarized_result = await summary_subtasks_result(task, options)
            result = summarized_result
            logger.info(f"Successfully generated summary for task {task.id}")
        except Exception as e:
            logger.error(f"Failed to generate summary for task {task.id}: {e}")
    elif task.subtasks and len(task.subtasks) == 1:
        logger.info(f"Task {task.id} has only 1 subtask, skipping LLM summary")
        if result and "--- Subtask" in result and "Result ---" in result:
            parts = result.split("Result ---", 1)
            if len(parts) > 1:
                result = parts[1].strip()

    return result
