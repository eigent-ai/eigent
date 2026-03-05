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
from typing import TYPE_CHECKING

from camel.tasks import Task

from app.agent.agent_model import agent_model
from app.agent.prompt import TASK_SUMMARY_SYS_PROMPT
from app.model.chat import Chat

if TYPE_CHECKING:
    from app.agent.listen_chat_agent import ListenChatAgent

logger = logging.getLogger("chat_service")


def task_summary_agent(options: Chat):
    return agent_model(
        "task_summary_agent",
        TASK_SUMMARY_SYS_PROMPT,
        options,
    )


async def summary_task(agent: ListenChatAgent, task: Task) -> str:
    prompt = f"""The user's task is:
---
{task.to_string()}
---
Your instructions are:
1.  Come up with a short and descriptive name for this task.
2.  Create a concise summary of the task's main points and objectives.
3.  Return the task name and the summary, separated by a vertical bar (|).

Example format: "Task Name|This is the summary of the task."
Do not include any other text or formatting.
"""
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


async def summary_subtasks_result(agent: ListenChatAgent, task: Task) -> str:
    """
    Summarize the aggregated results from all subtasks into a concise summary.

    Args:
        agent: The summary agent to use
        task: The main task containing subtasks and their aggregated results

    Returns:
        A concise summary of all subtask results
    """
    subtasks_info = ""
    for i, subtask in enumerate(task.subtasks, 1):
        subtasks_info += f"\n**Subtask {i}**\n"
        subtasks_info += f"Description: {subtask.content}\n"
        subtasks_info += f"Result: {subtask.result or 'No result'}\n"
        subtasks_info += "---\n"

    prompt = f"""You are a professional summarizer. \
Summarize the results of the following subtasks.

Main Task: {task.content}

Subtasks (with descriptions and results):
---
{subtasks_info}
---

Instructions:
1. Provide a concise summary of what was accomplished
2. Highlight key findings or outputs from each subtask
3. Mention any important files created or actions taken
4. Use bullet points or sections for clarity
5. DO NOT repeat the task name in your summary - go straight to the results
6. Keep it professional but conversational

Summary:
"""

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
    """
    Get the task result, with LLM summary if there are multiple subtasks.

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
            summary_agent = task_summary_agent(options)
            summarized_result = await summary_subtasks_result(
                summary_agent, task
            )
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
