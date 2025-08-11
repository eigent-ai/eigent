from camel.toolkits import SlackToolkit as BaseSlackToolkit
from camel.toolkits.function_tool import FunctionTool
from loguru import logger
from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


class SlackToolkit(BaseSlackToolkit, AbstractToolkit):
    agent_name: str = Agents.social_medium_agent

    def __init__(self, api_task_id: str, timeout: float | None = None):
        super().__init__(timeout)
        self.api_task_id = api_task_id

    @listen_toolkit(
        BaseSlackToolkit.create_slack_channel,
        lambda _, name, is_private=True: f"create a Slack channel with name: {name} and is_private: {is_private}",
    )
    def create_slack_channel(self, name: str, is_private: bool | None = True) -> str:
        return super().create_slack_channel(name, is_private)

    @listen_toolkit(
        BaseSlackToolkit.join_slack_channel,
        lambda _, channel_id: f"join Slack channel with id: {channel_id}",
    )
    def join_slack_channel(self, channel_id: str) -> str:
        return super().join_slack_channel(channel_id)

    @listen_toolkit(
        BaseSlackToolkit.leave_slack_channel,
        lambda _, channel_id: f"leave Slack channel with id: {channel_id}",
    )
    def leave_slack_channel(self, channel_id: str) -> str:
        return super().leave_slack_channel(channel_id)

    @listen_toolkit(
        BaseSlackToolkit.get_slack_channel_information,
        lambda _: "get Slack channel information",
    )
    def get_slack_channel_information(self) -> str:
        return super().get_slack_channel_information()

    @listen_toolkit(
        BaseSlackToolkit.get_slack_channel_message,
        lambda _, channel_id: f"get Slack channel message for channel id: {channel_id}",
    )
    def get_slack_channel_message(self, channel_id: str) -> str:
        return super().get_slack_channel_message(channel_id)

    @listen_toolkit(
        BaseSlackToolkit.send_slack_message,
        lambda _,
        message,
        channel_id,
        user=None: f"send Slack message: {message} to channel id: {channel_id} for user: {user}",
    )
    def send_slack_message(self, message: str, channel_id: str, user: str | None = None) -> str:
        return super().send_slack_message(message, channel_id, user)

    @listen_toolkit(
        BaseSlackToolkit.delete_slack_message,
        lambda _,
        time_stamp,
        channel_id: f"delete Slack message with timestamp: {time_stamp} in channel id: {channel_id}",
    )
    def delete_slack_message(self, time_stamp: str, channel_id: str) -> str:
        return super().delete_slack_message(time_stamp, channel_id)

    @classmethod
    def get_can_use_tools(cls, api_task_id: str) -> list[FunctionTool]:
        logger.debug(f"slack===={env('SLACK_BOT_TOKEN')}")
        if env("SLACK_BOT_TOKEN") or env("SLACK_USER_TOKEN"):
            return SlackToolkit(api_task_id).get_tools()
        else:
            return []
