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

"""Chat service package — re-exports for backward compatibility."""

from app.agent.factory.question_confirm import question_confirm
from app.agent.factory.task_summary import (
    get_task_result_with_optional_summary,
    summary_subtasks_result,
    summary_task,
)
from app.service.chat_service._step_solve import step_solve
from app.service.chat_service.lifecycle import (
    add_sub_tasks,
    construct_workforce,
    format_agent_description,
    install_mcp,
    new_agent_model,
    to_sub_tasks,
    tree_sub_tasks,
    update_sub_tasks,
)
from app.utils.context import (
    build_context_for_workforce,
    build_conversation_context,
    check_conversation_history_length,
    collect_previous_task_context,
    format_task_context,
)

__all__ = [
    "step_solve",
    "build_context_for_workforce",
    "build_conversation_context",
    "check_conversation_history_length",
    "collect_previous_task_context",
    "format_task_context",
    "get_task_result_with_optional_summary",
    "question_confirm",
    "summary_subtasks_result",
    "summary_task",
    "add_sub_tasks",
    "construct_workforce",
    "format_agent_description",
    "install_mcp",
    "new_agent_model",
    "to_sub_tasks",
    "tree_sub_tasks",
    "update_sub_tasks",
]
