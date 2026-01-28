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
from app.agent.factory.question_confirm import question_confirm_agent
from app.agent.factory.social_medium import social_medium_agent
from app.agent.factory.task_summary import task_summary_agent

__all__ = [
    "browser_agent",
    "developer_agent",
    "document_agent",
    "mcp_agent",
    "multi_modal_agent",
    "question_confirm_agent",
    "social_medium_agent",
    "task_summary_agent",
]
