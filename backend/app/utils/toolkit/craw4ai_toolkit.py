from camel.toolkits import Crawl4AIToolkit as BaseCrawl4AIToolkit

from app.service.task import Agents
from app.utils.listen.toolkit_listen import listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


class Crawl4AIToolkit(BaseCrawl4AIToolkit, AbstractToolkit):
    agent_name: str = Agents.search_agent

    def __init__(self, api_task_id: str, timeout: float | None = None):
        self.api_task_id = api_task_id
        super().__init__(timeout)

    # async def _get_client(self):
    #     r"""Get or create the AsyncWebCrawler client."""
    #     if self._client is None:
    #         from crawl4ai import AsyncWebCrawler

    #         self._client = AsyncWebCrawler(use_managed_browser=True)
    #         await self._client.__aenter__()
    #     return self._client

    @listen_toolkit(BaseCrawl4AIToolkit.scrape)
    async def scrape(self, url: str) -> str:
        return await super().scrape(url)

    def toolkit_name(self) -> str:
        return "Crawl Toolkit"
