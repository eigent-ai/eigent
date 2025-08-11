from typing import Any, Dict, List
from camel.toolkits import RedditToolkit as BaseRedditToolkit
from camel.toolkits.function_tool import FunctionTool
from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


class RedditToolkit(BaseRedditToolkit, AbstractToolkit):
    agent_name: str = Agents.social_medium_agent

    def __init__(
        self,
        api_task_id: str,
        retries: int = 3,
        delay: float = 0,
        timeout: float | None = None,
    ):
        super().__init__(retries, delay, timeout)
        self.api_task_id = api_task_id

    @listen_toolkit(
        BaseRedditToolkit.collect_top_posts,
        lambda _,
        subreddit_name,
        post_limit=5,
        comment_limit=5: f"collect top posts from subreddit: {subreddit_name} with post limit: {post_limit} and comment limit: {comment_limit}",
        lambda result: f"top posts collected: {result}",
    )
    def collect_top_posts(
        self, subreddit_name: str, post_limit: int = 5, comment_limit: int = 5
    ) -> List[Dict[str, Any]] | str:
        return super().collect_top_posts(subreddit_name, post_limit, comment_limit)

    @listen_toolkit(
        BaseRedditToolkit.perform_sentiment_analysis,
        lambda _, data: f"perform sentiment analysis on data number: {len(data)}",
        lambda result: f"perform analysis result: {result}",
    )
    def perform_sentiment_analysis(self, data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return super().perform_sentiment_analysis(data)

    @listen_toolkit(
        BaseRedditToolkit.track_keyword_discussions,
        lambda _,
        subreddits,
        keywords,
        post_limit=10,
        comment_limit=10,
        sentiment_analysis=False: f"track keyword discussions for subreddits: {subreddits}, keywords: {keywords}",
        lambda result: f"track keyword discussions result: {result}",
    )
    def track_keyword_discussions(
        self,
        subreddits: List[str],
        keywords: List[str],
        post_limit: int = 10,
        comment_limit: int = 10,
        sentiment_analysis: bool = False,
    ) -> List[Dict[str, Any]] | str:
        return super().track_keyword_discussions(subreddits, keywords, post_limit, comment_limit, sentiment_analysis)

    @classmethod
    def get_can_use_tools(cls, api_task_id: str) -> list[FunctionTool]:
        if env("REDDIT_CLIENT_ID") and env("REDDIT_CLIENT_SECRET") and env("REDDIT_USER_AGENT"):
            return RedditToolkit(api_task_id).get_tools()
        else:
            return []
