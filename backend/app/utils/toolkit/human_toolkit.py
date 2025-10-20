import asyncio
from camel.toolkits.base import BaseToolkit
from camel.toolkits.function_tool import FunctionTool
from app.service.task import Action, ActionAskData, ActionNoticeData, get_task_lock
from app.utils.listen.toolkit_listen import auto_listen_toolkit, listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from app.service.task import process_task
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("human_toolkit")


@auto_listen_toolkit(BaseToolkit)
class HumanToolkit(BaseToolkit, AbstractToolkit):
    r"""A class representing a toolkit for human interaction.
    Note:
        This toolkit should be called to send a tidy message to the user to
        keep them informed.
    """

    agent_name: str

    def __init__(self, api_task_id: str, agent_name: str, timeout: float | None = None):
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
        await task_lock.put_queue(
            ActionAskData(
                action=Action.ask,
                data={
                    "question": question,
                    "agent": self.agent_name,
                },
            )
        )

        reply = await task_lock.get_human_input(self.agent_name)
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
        logger.info(f"\nAgent Message:\n{message_title} {message_description} {message_attachment}")
        task_lock = get_task_lock(self.api_task_id)
        asyncio.create_task(
            task_lock.put_queue(
                ActionNoticeData(
                    process_task_id=process_task.get(""),
                    data=f"{message_description}",
                )
            )
        )

        attachment_info = f" {message_attachment}" if message_attachment else ""
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
    def get_can_use_tools(cls, api_task_id: str, agent_name: str) -> list[FunctionTool]:
        human = cls(api_task_id, agent_name)
        return [
            FunctionTool(human.ask_human_via_gui),
        ]
