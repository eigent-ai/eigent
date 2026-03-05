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

"""Passthrough SSE event handling + re-exports of shared context utilities."""

from app.model.chat import sse_json
from app.service.task import Action

# Re-export context utilities from shared location
from app.utils.context import (  # noqa: F401
    build_context_for_workforce,
    build_conversation_context,
    check_conversation_history_length,
    collect_previous_task_context,
    format_task_context,
)


def handle_passthrough_event(item) -> str | None:
    """Handle simple passthrough events that just forward data as SSE.

    Returns:
        SSE JSON string if the action is a passthrough, None otherwise.
    """
    if item.action == Action.create_agent:
        return sse_json("create_agent", item.data)
    elif item.action == Action.activate_agent:
        return sse_json("activate_agent", item.data)
    elif item.action == Action.deactivate_agent:
        return sse_json("deactivate_agent", dict(item.data))
    elif item.action == Action.assign_task:
        return sse_json("assign_task", item.data)
    elif item.action == Action.activate_toolkit:
        return sse_json("activate_toolkit", item.data)
    elif item.action == Action.deactivate_toolkit:
        return sse_json("deactivate_toolkit", item.data)
    elif item.action == Action.write_file:
        return sse_json(
            "write_file",
            {
                "file_path": item.data,
                "process_task_id": item.process_task_id,
            },
        )
    elif item.action == Action.ask:
        return sse_json("ask", item.data)
    elif item.action == Action.notice:
        return sse_json(
            "notice",
            {
                "notice": item.data,
                "process_task_id": item.process_task_id,
            },
        )
    elif item.action == Action.search_mcp:
        return sse_json("search_mcp", item.data)
    elif item.action == Action.terminal:
        return sse_json(
            "terminal",
            {
                "output": item.data,
                "process_task_id": item.process_task_id,
            },
        )
    elif item.action == Action.decompose_text:
        return sse_json("decompose_text", item.data)
    elif item.action == Action.decompose_progress:
        return sse_json("to_sub_tasks", item.data)
    return None
