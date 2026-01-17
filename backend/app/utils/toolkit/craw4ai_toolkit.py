from camel.toolkits import Crawl4AIToolkit as BaseCrawl4AIToolkit

from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


@auto_listen_toolkit(BaseCrawl4AIToolkit)
class Crawl4AIToolkit(BaseCrawl4AIToolkit, AbstractToolkit):
    agent_name: str = Agents.browser_agent

    def __init__(self, api_project_id: str, timeout: float | None = None):
        self.api_project_id = api_project_id
        super().__init__(timeout)

    def toolkit_name(self) -> str:
        return "Crawl Toolkit"
