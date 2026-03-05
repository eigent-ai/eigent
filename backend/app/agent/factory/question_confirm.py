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

from app.agent.agent_model import agent_model
from app.agent.prompt import (
    QUESTION_CONFIRM_PROMPT,
    QUESTION_CONFIRM_SYS_PROMPT,
)
from app.agent.utils import NOW_STR
from app.model.chat import Chat
from app.utils.context import build_conversation_context

if TYPE_CHECKING:
    from app.service.task import TaskLock

logger = logging.getLogger(__name__)


def _create_question_agent(options: Chat):
    """Create a question classification agent."""
    return agent_model(
        "question_confirm_agent",
        QUESTION_CONFIRM_SYS_PROMPT.format(now_str=NOW_STR),
        options,
    )


async def question_confirm(
    prompt: str, options: Chat, task_lock: TaskLock
) -> bool:
    """Classify whether a user query is a complex task or simple question.

    Creates and caches the question agent on task_lock.question_agent
    for reuse across multi-turn conversations.

    Returns True for complex tasks, False for simple questions.
    """
    if (
        not hasattr(task_lock, "question_agent")
        or task_lock.question_agent is None
    ):
        task_lock.question_agent = _create_question_agent(options)

    agent = task_lock.question_agent

    context_prompt = build_conversation_context(
        task_lock, header="=== Previous Conversation ==="
    )

    full_prompt = QUESTION_CONFIRM_PROMPT.format(
        context_prompt=context_prompt, user_query=prompt
    )

    try:
        resp = agent.step(full_prompt)

        if not resp or not resp.msgs or len(resp.msgs) == 0:
            logger.warning(
                "No response from agent, defaulting to complex task"
            )
            return True

        content = resp.msgs[0].content
        if not content:
            logger.warning(
                "Empty content from agent, defaulting to complex task"
            )
            return True

        normalized = content.strip().lower()
        is_complex = "yes" in normalized

        result_str = "complex task" if is_complex else "simple question"
        logger.info(
            f"Question confirm result: {result_str}",
            extra={"response": content, "is_complex": is_complex},
        )

        return is_complex

    except Exception as e:
        logger.error(f"Error in question_confirm: {e}")
        raise
