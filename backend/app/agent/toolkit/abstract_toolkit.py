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

import logging

from camel.toolkits.function_tool import FunctionTool
from inflection import titleize

from app.model.enums import ApprovalAction
from app.service.task import get_task_lock

logger = logging.getLogger("abstract_toolkit")


class AbstractToolkit:
    api_task_id: str
    agent_name: str

    @classmethod
    def get_can_use_tools(cls, api_task_id: str) -> list[FunctionTool]:
        """default return all tools, subclass can override this method to filter tools"""
        return cls(api_task_id).get_tools()  # type: ignore

    @classmethod
    def toolkit_name(cls) -> str:
        return titleize(cls.__name__)

    async def _request_user_approval(self, action_data) -> str | None:
        """Request user approval for a dangerous operation.

        Follows the same pattern as HumanToolkit.ask_human_via_gui:
        push an SSE event via ``put_queue``, then ``await`` the
        response on an agent-specific asyncio.Queue (keyed by
        ``self.agent_name``).

        Args:
            action_data: A Pydantic model (e.g. ActionCommandApprovalData)
                to send to the frontend via SSE.

        Returns:
            None if the operation is approved (caller should proceed),
            or an error message string if rejected.
        """
        task_lock = get_task_lock(self.api_task_id)
        if task_lock.auto_approve.get(self.agent_name, False):
            return None

        logger.info(
            "[APPROVAL] Pushing approval event to SSE queue, "
            "api_task_id=%s, agent=%s, action=%s",
            self.api_task_id,
            self.agent_name,
            action_data.action,
        )

        # Push the approval prompt to the SSE stream
        # (same as ask_human_via_gui's put_queue call)
        await task_lock.put_queue(action_data)

        logger.info("[APPROVAL] Event pushed, waiting for user response")

        # Wait for the user's response via agent-specific asyncio.Queue
        # (same as ask_human_via_gui's get_human_input call)
        approval = await task_lock.get_approval_input(self.agent_name)

        logger.info("[APPROVAL] Received response: %s", approval)

        # Fail-closed: only explicitly approved values proceed;
        # unrecognised responses default to rejection.
        if approval == ApprovalAction.approve_once:
            return None
        if approval == ApprovalAction.auto_approve:
            task_lock.auto_approve[self.agent_name] = True
            return None
        # ApprovalAction.reject or any unexpected value —
        # The frontend will also send a skip-task request to stop the
        # task entirely, so this return value is mainly a safety net.
        return "Operation rejected by user. The task is being stopped."
