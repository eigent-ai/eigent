from typing import List
from camel.toolkits import FunctionTool, TwitterToolkit as BaseTwitterToolkit
from camel.toolkits.twitter_toolkit import (
    create_tweet,
    delete_tweet,
    get_my_user_profile,
    get_user_by_username,
)

from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit, listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


@auto_listen_toolkit(BaseTwitterToolkit)
class TwitterToolkit(BaseTwitterToolkit, AbstractToolkit):
    agent_name: str = Agents.social_medium_agent

    def __init__(self, api_task_id: str, timeout: float | None = None):
        super().__init__(timeout)
        self.api_task_id = api_task_id

    @listen_toolkit(
        create_tweet,
        lambda _, text, **kwargs: f"create tweet with text: {text} and options: {kwargs}",
    )
    def create_tweet(
        self,
        text: str,
        poll_options: list[str] | None = None,
        poll_duration_minutes: int | None = None,
        quote_tweet_id: int | str | None = None,
    ) -> str:
        return create_tweet(text, poll_options, poll_duration_minutes, quote_tweet_id)

    @listen_toolkit(
        delete_tweet,
        lambda _, tweet_id: f"delete tweet with id: {tweet_id}",
    )
    def delete_tweet(self, tweet_id: str) -> str:
        return delete_tweet(tweet_id)

    @listen_toolkit(
        get_user_by_username,
        lambda _: "get my user profile",
    )
    def get_my_user_profile(self) -> str:
        return get_my_user_profile()

    @listen_toolkit(
        get_user_by_username,
        lambda _, username: f"get user by username: {username}",
    )
    def get_user_by_username(self, username: str) -> str:
        return get_user_by_username(username)

    def get_tools(self) -> List[FunctionTool]:
        return [
            FunctionTool(self.create_tweet),
            FunctionTool(self.delete_tweet),
            FunctionTool(self.get_my_user_profile),
            FunctionTool(self.get_user_by_username),
        ]

    @classmethod
    def get_can_use_tools(cls, api_task_id: str) -> List[FunctionTool]:
        if (
            env("TWITTER_CONSUMER_KEY")
            and env("TWITTER_CONSUMER_SECRET")
            and env("TWITTER_ACCESS_TOKEN")
            and env("TWITTER_ACCESS_TOKEN_SECRET")
        ):
            return TwitterToolkit(api_task_id).get_tools()
        else:
            return []
