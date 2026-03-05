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

from app.agent.factory.browser import browser_agent
from app.agent.factory.developer import developer_agent
from app.agent.factory.document import document_agent
from app.agent.factory.mcp import mcp_agent
from app.agent.factory.multi_modal import multi_modal_agent
from app.agent.factory.question_confirm import question_confirm
from app.agent.factory.social_media import social_media_agent
from app.agent.factory.task_summary import (
    get_task_result_with_optional_summary,
    summary_subtasks_result,
    summary_task,
)
from app.agent.factory.workforce_agents import (
    create_coordinator_and_task_agents,
    create_new_worker_agent,
)

__all__ = [
    "browser_agent",
    "create_coordinator_and_task_agents",
    "create_new_worker_agent",
    "developer_agent",
    "document_agent",
    "get_task_result_with_optional_summary",
    "mcp_agent",
    "multi_modal_agent",
    "question_confirm",
    "social_media_agent",
    "summary_subtasks_result",
    "summary_task",
]
