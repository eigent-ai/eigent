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

import asyncio
import logging
import queue as stdlib_queue
import threading
from collections.abc import Coroutine

from camel.toolkits.function_tool import FunctionTool
from inflection import titleize

from app.model.enums import ApprovalAction
from app.service.task import get_task_lock

logger = logging.getLogger("abstract_toolkit")

# Timeout for user approval (seconds)
_APPROVAL_TIMEOUT_SECONDS = 300


class AbstractToolkit:
    api_task_id: str
    agent_name: str

    # Shared thread-local storage for per-thread event loops.
    # Used by _run_coro_sync to bridge async → sync in worker threads.
    _thread_local = threading.local()

    @classmethod
    def get_can_use_tools(cls, api_task_id: str) -> list[FunctionTool]:
        """default return all tools, subclass can override this method to filter tools"""
        return cls(api_task_id).get_tools()  # type: ignore

    @classmethod
    def toolkit_name(cls) -> str:
        return titleize(cls.__name__)

    @staticmethod
    def _run_coro_sync(coro: Coroutine) -> None:
        """Run a coroutine synchronously in a thread-local event loop.

        This is used when we need to call an async function (e.g.
        ``task_lock.put_queue``) from a synchronous context (the Camel
        tool callback runs in a worker thread, not an async task).

        The method reuses a per-thread event loop stored on
        ``AbstractToolkit._thread_local`` so that repeated calls from
        the same thread don't create a new loop every time.  If the
        loop has been closed (e.g. after an error), a fresh one is
        created automatically.

        Unlike ``_run_coro_in_thread``, this does **not** register the
        coroutine in ``task_lock.background_tasks`` for later cleanup.
        Use this for fire-and-forget coroutines like pushing user
        approval prompts to the SSE queue.

        Args:
            coro: An awaitable coroutine object to run to completion.
                  Typically ``task_lock.put_queue(data)``.

        Raises:
            No exception is raised; errors are logged and swallowed so
            the caller can continue (the worst case is the approval
            prompt not reaching the frontend).
        """
        if not hasattr(AbstractToolkit._thread_local, "loop"):
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            AbstractToolkit._thread_local.loop = loop
        else:
            loop = AbstractToolkit._thread_local.loop

        if loop.is_closed():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            AbstractToolkit._thread_local.loop = loop

        try:
            loop.run_until_complete(coro)
        except Exception as e:
            logger.error(f"Failed to execute coroutine: {e}", exc_info=True)

    def _request_user_approval(self, action_data) -> str | None:
        """Request user approval for a dangerous operation.

        Sends an SSE event to the frontend asking the user to approve
        or reject the operation, then blocks until a response arrives
        or the timeout expires.

        Subclasses should override this to customise the action data
        or add toolkit-specific logic.  The base implementation handles
        the generic approval flow: push to SSE queue, wait for response,
        handle timeout, and interpret the ApprovalAction enum.

        Args:
            action_data: A Pydantic model (e.g. ActionCommandApprovalData)
                to send to the frontend via SSE.

        Returns:
            None if the operation is approved (caller should proceed),
            or an error message string if rejected / timed out.
        """
        task_lock = get_task_lock(self.api_task_id)
        if getattr(task_lock, "auto_approve", False):
            return None

        coro = task_lock.put_queue(action_data)
        self._run_coro_sync(coro)

        try:
            approval = task_lock.approval_response.get(
                block=True, timeout=_APPROVAL_TIMEOUT_SECONDS
            )
        except stdlib_queue.Empty:
            logger.warning(
                "User approval timed out after %ds, rejecting operation",
                _APPROVAL_TIMEOUT_SECONDS,
                extra={"api_task_id": self.api_task_id},
            )
            return (
                f"Operation rejected: approval timed out after "
                f"{_APPROVAL_TIMEOUT_SECONDS} seconds."
            )

        # Fail-closed: only explicitly approved values proceed;
        # unrecognised responses default to rejection.
        if approval == ApprovalAction.approve_once:
            return None
        if approval == ApprovalAction.auto_approve:
            task_lock.auto_approve = True
            return None
        # ApprovalAction.reject or any unexpected value
        return "Operation rejected by user."
