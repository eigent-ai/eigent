from typing import Any, Dict, List, Literal
from camel.toolkits import SearchToolkit as BaseSearchToolkit
from camel.toolkits.function_tool import FunctionTool
import httpx
from app.component.environment import env, env_not_empty
from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit, listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("search_toolkit")


@auto_listen_toolkit(BaseSearchToolkit)
class SearchToolkit(BaseSearchToolkit, AbstractToolkit):
    agent_name: str = Agents.search_agent

    def __init__(
        self,
        api_task_id: str,
        agent_name: str | None = None,
        timeout: float | None = None,
        exclude_domains: List[str] | None = None,
    ):
        self.api_task_id = api_task_id
        if agent_name is not None:
            self.agent_name = agent_name
        super().__init__(
            timeout=timeout, exclude_domains=exclude_domains
        )

    # @listen_toolkit(BaseSearchToolkit.search_wiki)
    # def search_wiki(self, entity: str) -> str:
    #     return super().search_wiki(entity)

    # @listen_toolkit(
    #     BaseSearchToolkit.search_linkup,
    #     lambda _,
    #     query,
    #     depth="standard",
    #     output_type="searchResults",
    #     structured_output_schema=None: f"Search linkup with query '{query}', depth '{depth}', output type '{output_type}', structured output schema '{structured_output_schema}'",
    #     lambda result: f"Search linkup returned {len(result)} results",
    # )
    # def search_linkup(
    #     self,
    #     query: str,
    #     depth: Literal["standard", "deep"] = "standard",
    #     output_type: Literal["searchResults", "sourcedAnswer", "structured"] = "searchResults",
    #     structured_output_schema: str | None = None,
    # ) -> dict[str, Any]:
    #     return super().search_linkup(query, depth, output_type, structured_output_schema)

    @listen_toolkit(
        BaseSearchToolkit.search_google,
        lambda _, query, search_type="web", number_of_result_pages=10, start_page=1: f"with query '{query}', {search_type} type, {number_of_result_pages} result pages starting from page {start_page}",
    )
    def search_google(
        self,
        query: str,
        search_type: str = "web",
        number_of_result_pages: int = 10,
        start_page: int = 1
    ) -> list[dict[str, Any]]:
        if env("GOOGLE_API_KEY") and env("SEARCH_ENGINE_ID"):
            return super().search_google(query, search_type, number_of_result_pages, start_page)
        else:
            return self.cloud_search_google(query, search_type, number_of_result_pages, start_page)

    def cloud_search_google(
        self,
        query: str,
        search_type: str = "web",
        number_of_result_pages: int = 10,
        start_page: int = 1
    ):
        url = env_not_empty("SERVER_URL")
        res = httpx.get(
            url + "/proxy/google",
            params={
                "query": query,
                "search_type": search_type,
                "number_of_result_pages": number_of_result_pages,
                "start_page": start_page
            },
            headers={"api-key": env_not_empty("cloud_api_key")},
        )
        return res.json()

    # @listen_toolkit(
    #     BaseSearchToolkit.search_duckduckgo,
    #     lambda _,
    #     query,
    #     source="text",
    #     max_results=5: f"Search DuckDuckGo with query '{query}', source '{source}', and max results {max_results}",
    #     lambda result: f"Search DuckDuckGo returned {len(result)} results",
    # )
    # def search_duckduckgo(self, query: str, source: str = "text", max_results: int = 5) -> list[dict[str, Any]]:
    #     return super().search_duckduckgo(query, source, max_results)

    # @listen_toolkit(
    #     BaseSearchToolkit.tavily_search,
    #     lambda _, query, num_results=5, **kwargs: f"Search Tavily with query '{query}' and {num_results} results",
    #     lambda result: f"Search Tavily returned {len(result)} results",
    # )
    # def tavily_search(self, query: str, num_results: int = 5, **kwargs) -> list[dict[str, Any]]:
    #     return super().tavily_search(query, num_results, **kwargs)

    # @listen_toolkit(
    #     BaseSearchToolkit.search_brave,
    #     lambda _, query, *args, **kwargs: f"Search Brave with query '{query}'",
    #     lambda result: f"Search Brave returned {len(result)} results",
    # )
    # def search_brave(
    #     self,
    #     q: str,
    #     country: str = "US",
    #     search_lang: str = "en",
    #     ui_lang: str = "en-US",
    #     count: int = 20,
    #     offset: int = 0,
    #     safesearch: str = "moderate",
    #     freshness: str | None = None,
    #     text_decorations: bool = True,
    #     spellcheck: bool = True,
    #     result_filter: str | None = None,
    #     goggles_id: str | None = None,
    #     units: str | None = None,
    #     extra_snippets: bool | None = None,
    #     summary: bool | None = None,
    # ) -> dict[str, Any]:
    #     return super().search_brave(
    #         q,
    #         country,
    #         search_lang,
    #         ui_lang,
    #         count,
    #         offset,
    #         safesearch,
    #         freshness,
    #         text_decorations,
    #         spellcheck,
    #         result_filter,
    #         goggles_id,
    #         units,
    #         extra_snippets,
    #         summary,
    #     )

    # @listen_toolkit(
    #     BaseSearchToolkit.search_bocha,
    #     lambda _,
    #     query,
    #     freshness="noLimit",
    #     summary=False,
    #     count=10,
    #     page=1: f"Search Bocha with query '{query}', freshness '{freshness}', summary '{summary}', count {count}, and page {page}",
    #     lambda result: f"Search Bocha returned {len(result)} results",
    # )
    # def search_bocha(
    #     self,
    #     query: str,
    #     freshness: str = "noLimit",
    #     summary: bool = False,
    #     count: int = 10,
    #     page: int = 1,
    # ) -> dict[str, Any]:
    #     return super().search_bocha(query, freshness, summary, count, page)

    # @listen_toolkit(
    #     BaseSearchToolkit.search_baidu,
    #     lambda _, query, max_results=5: f"Search Baidu with query '{query}' and max results {max_results}",
    #     lambda result: f"Search Baidu returned {len(result)} results",
    # )
    # def search_baidu(self, query: str, max_results: int = 5) -> dict[str, Any]:
    #     return super().search_baidu(query, max_results)

    # @listen_toolkit(
    #     BaseSearchToolkit.search_bing,
    #     lambda _, query: f"with query '{query}'",
    #     lambda result: f"Search Bing returned {len(result)} results",
    # )
    # def search_bing(self, query: str) -> dict[str, Any]:
    #     return super().search_bing(query)

    # @listen_toolkit(BaseSearchToolkit.search_exa, lambda _, query, *args, **kwargs: f"{query}, {args}, {kwargs}")
    # def search_exa(
    #     self,
    #     query: str,
    #     search_type: Literal["auto", "neural", "keyword"] = "auto",
    #     category: None
    #     | Literal[
    #         "company",
    #         "research paper",
    #         "news",
    #         "pdf",
    #         "github",
    #         "tweet",
    #         "personal site",
    #         "linkedin profile",
    #         "financial report",
    #     ] = None,
    #     include_text: List[str] | None = None,
    #     exclude_text: List[str] | None = None,
    #     use_autoprompt: bool = True,
    #     text: bool = False,
    # ) -> Dict[str, Any]:
    #     if env("EXA_API_KEY"):
    #         res = super().search_exa(query, search_type, category, include_text, exclude_text, use_autoprompt, text)
    #         return res
    #     else:
    #         return self.cloud_search_exa(query, search_type, category, include_text, exclude_text, use_autoprompt, text)
    #
    # def cloud_search_exa(
    #     self,
    #     query: str,
    #     search_type: Literal["auto", "neural", "keyword"] = "auto",
    #     category: None
    #     | Literal[
    #         "company",
    #         "research paper",
    #         "news",
    #         "pdf",
    #         "github",
    #         "tweet",
    #         "personal site",
    #         "linkedin profile",
    #         "financial report",
    #     ] = None,
    #     include_text: List[str] | None = None,
    #     exclude_text: List[str] | None = None,
    #     use_autoprompt: bool = True,
    #     text: bool = False,
    # ):
    #     url = env_not_empty("SERVER_URL")
    #     logger.debug(f">>>>>>>>>>>>>>>>{url}<<<<")
    #     res = httpx.post(
    #         url + "/proxy/exa",
    #         json={
    #             "query": query,
    #             "search_type": search_type,
    #             "category": category,
    #             "include_text": include_text,
    #             "exclude_text": exclude_text,
    #             "use_autoprompt": use_autoprompt,
    #             "text": text,
    #         },
    #         headers={"api-key": env_not_empty("cloud_api_key")},
    #     )
    #     logger.debug(">>>>>>>>>>>>>>>>>")
    #     logger.debug(res)
    #     return res.json()

    # @listen_toolkit(
    #     BaseSearchToolkit.search_alibaba_tongxiao,
    #     lambda _, *args, **kwargs: f"Search Alibaba Tongxiao with args {args} and kwargs {kwargs}",
    #     lambda result: f"Search Alibaba Tongxiao returned {len(result)} results",
    # )
    # def search_alibaba_tongxiao(
    #     self,
    #     query: str,
    #     time_range: Literal["OneDay", "OneWeek", "OneMonth", "OneYear", "NoLimit"] = "NoLimit",
    #     industry: Literal[
    #         "finance",
    #         "law",
    #         "medical",
    #         "internet",
    #         "tax",
    #         "news_province",
    #         "news_center",
    #     ]
    #     | None = None,
    #     page: int = 1,
    #     return_main_text: bool = False,
    #     return_markdown_text: bool = True,
    #     enable_rerank: bool = True,
    # ) -> Dict[str, Any]:
    #     return super().search_alibaba_tongxiao(
    #         query,
    #         time_range,
    #         industry,
    #         page,
    #         return_main_text,
    #         return_markdown_text,
    #         enable_rerank,
    #     )

    @classmethod
    def get_can_use_tools(cls, api_task_id: str) -> list[FunctionTool]:
        search_toolkit = SearchToolkit(api_task_id)
        tools = [
            # FunctionTool(search_toolkit.search_wiki),
            # FunctionTool(search_toolkit.search_duckduckgo),
            # FunctionTool(search_toolkit.search_baidu),
            # FunctionTool(search_toolkit.search_bing),
        ]
        # if env("LINKUP_API_KEY"):
        #     tools.append(FunctionTool(search_toolkit.search_linkup))

        # if env("BRAVE_API_KEY"):
        #     tools.append(FunctionTool(search_toolkit.search_brave))

        if (env("GOOGLE_API_KEY") and env("SEARCH_ENGINE_ID")) or env("cloud_api_key"):
            tools.append(FunctionTool(search_toolkit.search_google))

        # if env("TAVILY_API_KEY"):
        #     tools.append(FunctionTool(search_toolkit.tavily_search))

        # if env("BOCHA_API_KEY"):
        #     tools.append(FunctionTool(search_toolkit.search_bocha))

        # if env("EXA_API_KEY") or env("cloud_api_key"):
        #     tools.append(FunctionTool(search_toolkit.search_exa))

        # if env("TONGXIAO_API_KEY"):
        #     tools.append(FunctionTool(search_toolkit.search_alibaba_tongxiao))
        return tools

    # def get_tools(self) -> List[FunctionTool]:
    #     return [FunctionTool(self.search_exa)]
