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
import uuid

from camel.toolkits.base import BaseToolkit
from camel.toolkits.function_tool import FunctionTool

from app.agent.toolkit.abstract_toolkit import AbstractToolkit
from app.run_context import RunContext
from app.run_journal import get_default_run_journal
from app.run_runtime.active_timeout import pause_active_execution_timeout
from app.run_runtime.tool_checkpoint import get_current_tool_checkpoint
from app.service.task import (
    TASK_LOCK_CLEANUP_SENTINEL,
    Action,
    ActionAskData,
    ActionNoticeData,
    get_task_lock,
    process_task,
)
from app.utils.listen.toolkit_listen import auto_listen_toolkit, listen_toolkit

logger = logging.getLogger("human_toolkit")


@auto_listen_toolkit(BaseToolkit)
class HumanToolkit(BaseToolkit, AbstractToolkit):
    r"""A class representing a toolkit for human interaction.
    Note:
        This toolkit should be called to send a tidy message to the user to
        keep them informed.
    """

    agent_name: str

    def __init__(
        self, api_task_id: str, agent_name: str, timeout: float | None = None
    ):
        super().__init__(timeout)
        self.api_task_id = api_task_id
        self.agent_name = agent_name
        task_lock = get_task_lock(self.api_task_id)
        task_lock.add_human_input_listen(self.agent_name)

    @listen_toolkit(inputs=lambda _, question: question)
    async def ask_human_via_gui(self, question: str) -> str:
        """Use this tool to ask a question to the user when you are stuck,
        need clarification, or require a decision to be made. This is a
        two-way communication channel that will wait for the user's response.
        You should use it to:
        - Clarify ambiguous instructions or requirements.
        - Request missing information that you cannot find (e.g., login
        credentials, file paths).
        - Ask for a decision when there are multiple viable options.
        - Seek help when you encounter an error you cannot resolve on your own.
        Args:
            question (str): The question to ask the user.

        Returns:
            str: The user's response to the question.
        """
        logger.info(f"Question: {question}")
        task_lock = get_task_lock(self.api_task_id)
        run_context = getattr(task_lock, "run_context", None)
        interaction_id: str | None = None
        if isinstance(run_context, RunContext):
            run = await asyncio.to_thread(
                get_default_run_journal().get_run, run_context.run_id
            )
            if run is None or run.active_attempt_id is None:
                raise RuntimeError(
                    "human interaction has no active durable RunAttempt"
                )
            interaction_id = str(uuid.uuid4())
            await asyncio.to_thread(
                get_default_run_journal().create_human_interaction,
                interaction_id=interaction_id,
                run_id=run_context.run_id,
                attempt_id=run.active_attempt_id,
                interaction_type="question",
                request={"question": question, "agent": self.agent_name},
                response_schema={"type": "string", "minLength": 1},
                requested_by=f"agent:{self.agent_name}",
            )
            try:
                from app.run_sync.runtime import (
                    notify_default_cloud_sync_worker,
                )

                notify_default_cloud_sync_worker()
            except Exception:
                logger.exception(
                    "Failed to wake cloud sync for HumanInteraction"
                )
        ask_payload = {
            "question": question,
            "agent": self.agent_name,
        }
        if interaction_id is not None:
            ask_payload["interaction_id"] = interaction_id
            ask_payload["interaction_type"] = "question"
            ask_payload["run_id"] = run_context.run_id
            ask_payload["version"] = 0
        await task_lock.put_queue(
            ActionAskData(
                action=Action.ask,
                data=ask_payload,
            )
        )

        # A durable HumanInteraction is user-owned waiting time, not stalled
        # Agent execution. Keep both the hard step timeout and sliding stall
        # watchdog paused until the UI supplies a reply or cleanup interrupts
        # the wait, matching the durable Approval path.
        async with pause_active_execution_timeout(task_lock):
            reply = await task_lock.get_human_input(self.agent_name)
        if reply == TASK_LOCK_CLEANUP_SENTINEL:
            logger.info(
                "Human input wait interrupted by task cleanup",
                extra={
                    "task_id": self.api_task_id,
                    "agent": self.agent_name,
                },
            )
            raise asyncio.CancelledError(
                "Task cleanup interrupted human input wait"
            )
        logger.info(f"User reply: {reply}")
        return reply

    @listen_toolkit()
    def send_message_to_user(
        self,
        message_title: str,
        message_description: str,
        message_attachment: str | None = None,
    ) -> str:
        r"""Use this tool to send a tidy message to the user, including a
        short title, a one-sentence description, and an optional attachment.

        This one-way tool keeps the user informed about your progress,
        decisions, or actions. It does not require a response.
        You should use it to:
        - Announce what you are about to do.
        For example:
        message_title="Starting Task"
        message_description="Searching for papers on GUI Agents."
        - Report the result of an action.
        For example:
        message_title="Search Complete"
        message_description="Found 15 relevant papers."
        - Report a created file.
        For example:
        message_title="File Ready"
        message_description="The report is ready for your review."
        message_attachment="report.pdf"
        - State a decision.
        For example:
        message_title="Next Step"
        message_description="Analyzing the top 10 papers."
        - Give a status update during a long-running task.

        Args:
            message_title (str): The title of the message.
            message_description (str): The short description.
            message_attachment (str): The attachment of the message,
                which can be a file path or a URL.

        Returns:
            str: Confirmation that the message was successfully sent.
        """
        print(f"\nAgent Message:\n{message_title} \n{message_description}\n")
        if message_attachment:
            print(message_attachment)

        task_lock = get_task_lock(self.api_task_id)

        # Get process_task_id from ContextVar with fallback
        current_process_task_id = process_task.get("")
        if not current_process_task_id:
            current_process_task_id = self.api_task_id
            logger.warning(
                f"[send_message_to_user] ContextVar process_task is empty, using api_task_id as fallback: '{current_process_task_id}'"
            )

        from app.utils.listen.toolkit_listen import _safe_put_queue

        checkpoint = get_current_tool_checkpoint()
        tool_call_id = (
            checkpoint.tool_call_id if checkpoint is not None else None
        )
        notice_data = ActionNoticeData(
            process_task_id=current_process_task_id,
            data=f"{message_description}",
            title=f"{message_title}",
            notice_id=f"notice:{tool_call_id or uuid.uuid4()}",
            tool_call_id=tool_call_id,
        )
        _safe_put_queue(task_lock, notice_data)

        attachment_info = (
            f" {message_attachment}" if message_attachment else ""
        )
        return f"Message successfully sent to user: '{message_title} {message_description}{attachment_info}'"

    def get_tools(self) -> list[FunctionTool]:
        r"""Returns a list of FunctionTool objects representing the
        functions in the toolkit.

        Returns:
            List[FunctionTool]: A list of FunctionTool objects
                representing the functions in the toolkit.
        """
        return [
            FunctionTool(self.ask_human_via_gui),
            FunctionTool(self.send_message_to_user),
        ]

    @classmethod
    def get_can_use_tools(
        cls, api_task_id: str, agent_name: str
    ) -> list[FunctionTool]:
        human = cls(api_task_id, agent_name)
        return [
            FunctionTool(human.ask_human_via_gui),
            # Note: send_message_to_user is not included in get_can_use_tools
            # It is only available via get_tools() if needed
        ]
