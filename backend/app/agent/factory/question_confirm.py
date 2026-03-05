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
from app.agent.prompt import QUESTION_CONFIRM_SYS_PROMPT
from app.agent.utils import NOW_STR
from app.model.chat import Chat
from app.utils.context import build_conversation_context

if TYPE_CHECKING:
    from app.agent.listen_chat_agent import ListenChatAgent
    from app.service.task import TaskLock

logger = logging.getLogger("chat_service")


def question_confirm_agent(options: Chat):
    return agent_model(
        "question_confirm_agent",
        QUESTION_CONFIRM_SYS_PROMPT.format(now_str=NOW_STR),
        options,
    )


async def question_confirm(
    agent: ListenChatAgent, prompt: str, task_lock: TaskLock | None = None
) -> bool:
    """Simple question confirmation - returns True
    for complex tasks, False for simple questions."""

    context_prompt = ""
    if task_lock:
        context_prompt = build_conversation_context(
            task_lock, header="=== Previous Conversation ==="
        )

    full_prompt = f"""{context_prompt}User Query: {prompt}

Determine if this user query is a complex task or a simple question.

**Complex task** (answer "yes"): Requires tools, code execution, \
file operations, multi-step planning, or creating/modifying content
- Examples: "create a file", "search for X", \
"implement feature Y", "write code", "analyze data"

**Simple question** (answer "no"): Can be answered directly \
with knowledge or conversation history, no action needed
- Examples: greetings ("hello", "hi"), \
fact queries ("what is X?"), clarifications, status checks

Answer only "yes" or "no". Do not provide any explanation.

Is this a complex task? (yes/no):"""

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
