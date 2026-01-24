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
