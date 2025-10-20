import asyncio
import datetime
import json
import os
from typing import Any, Dict, List
import uuid
from camel.models import BaseModelBackend
from camel.toolkits.hybrid_browser_toolkit_py import HybridBrowserToolkit as BaseHybridBrowserToolkit
from camel.toolkits.hybrid_browser_toolkit_py.config_loader import ConfigLoader
from camel.toolkits.hybrid_browser_toolkit_py.browser_session import HybridBrowserSession as BaseHybridBrowserSession
from camel.toolkits.hybrid_browser_toolkit_py.actions import ActionExecutor
from camel.toolkits.hybrid_browser_toolkit_py.snapshot import PageSnapshot
from camel.toolkits.hybrid_browser_toolkit_py.agent import PlaywrightLLMAgent
from camel.toolkits.function_tool import FunctionTool
from app.component.environment import env
from app.exception.exception import ProgramException
from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit, listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("hybrid_browser_python_toolkit")


class BrowserSession(BaseHybridBrowserSession):
    async def _ensure_browser_inner(self) -> None:
        from playwright.async_api import async_playwright

        if self._page is not None:
            return

        self._playwright = await async_playwright().start()

        # Prepare stealth options
        launch_options: Dict[str, Any] = {"headless": self._headless}
        context_options: Dict[str, Any] = {}
        if self._stealth and self._stealth_config:
            # Use preloaded stealth configuration
            launch_options["args"] = self._stealth_config["launch_args"]
            context_options.update(self._stealth_config["context_options"])

        if self._user_data_dir:
            raise ProgramException("connect over cdp does not support set user_data_dir")
            # Path(self._user_data_dir).mkdir(parents=True, exist_ok=True)
            # pl = self._playwright
            # assert pl is not None
            # self._context = await pl.chromium.launch_persistent_context(
            #     user_data_dir=self._user_data_dir,
            #     headless=self._headless,
            # )
            # self._browser = self._context.browser
        else:
            pl = self._playwright
            assert pl is not None
            # self._browser = await pl.chromium.launch(headless=self._headless)
            port = env("browser_port", 9222)
            self._browser = await pl.chromium.connect_over_cdp(f"http://localhost:{port}")
            self._context = self._browser.contexts[0]

        # Reuse an already open page (persistent context may restore last
        # session)
        # if self._context.pages:
        #     self._page = self._context.pages[0]
        # else:
        #     self._page = await self._context.new_page()

        # Debug information to help trace concurrency issues

        # Initialize _pages as empty list
        self._pages = {}

        for index, item in enumerate(self._context.pages):
            if item.url.startswith("about:blank") and item.url != "about:blank":
                tab_id = "tab-" + str(index)
                self._page = item
                self._pages[tab_id] = self._page
                self._current_tab_id = tab_id
                await item.goto("about:blank")
                break

        # If no suitable page found, create a new one
        if not self._page:
            logger.debug(json.dumps([item.url for item in self._context.pages]))
            await asyncio.sleep(3)  # wait 3 sec, retry get new page
            await self.get_new_tab()
            logger.debug(json.dumps([item.url for item in self._context.pages]))
            if not self._page:
                raise ProgramException("Maximum Window Limit Reached.")

        # Apply stealth modifications if enabled
        if self._stealth and self._stealth_script:
            try:
                await self._page.add_init_script(self._stealth_script)
                logger.debug("Applied stealth script to main page")
            except Exception as e:
                logger.warning(f"Failed to apply stealth script: {e}")

                # Set up timeout for navigation
        self._page.set_default_navigation_timeout(self._navigation_timeout)
        self._page.set_default_timeout(self._navigation_timeout)

        # helpers
        self.snapshot = PageSnapshot(self._page)
        self.executor = ActionExecutor(
            self._page,
            self,
            default_timeout=self._default_timeout,
            short_timeout=self._short_timeout,
        )
        logger.info("Browser session initialized successfully")

    async def get_new_tab(self):
        assert self._context is not None

        # Initialize _pages if not already done
        if not hasattr(self, "_pages") or self._pages is None:
            self._pages = {}

        for index, item in enumerate(self._context.pages):
            if item.url.startswith("about:blank") and item.url != "about:blank":
                tab_id = "tab-" + str(index)
                self._pages[tab_id] = item
                await item.goto("about:blank")
                self._page = item
                self._current_tab_id = tab_id
                break


@auto_listen_toolkit(BaseHybridBrowserToolkit)
class HybridBrowserPythonToolkit(BaseHybridBrowserToolkit, AbstractToolkit):
    agent_name: str = Agents.search_agent

    def __init__(
        self,
        api_task_id: str,
        *,
        headless: bool = False,
        user_data_dir: str | None = None,
        stealth: bool = False,
        web_agent_model: BaseModelBackend | None = None,
        cache_dir: str = os.path.expanduser("~/.eigent/tmp/"),
        enabled_tools: List[str] | None = None,
        browser_log_to_file: bool = False,
        session_id: str | None = None,
        default_start_url: str = "https://google.com/",
        default_timeout: int | None = None,
        short_timeout: int | None = None,
        navigation_timeout: int | None = None,
        network_idle_timeout: int | None = None,
        screenshot_timeout: int | None = None,
        page_stability_timeout: int | None = None,
        dom_content_loaded_timeout: int | None = None,
    ) -> None:
        self.api_task_id = api_task_id
        self._headless = headless
        self._user_data_dir = user_data_dir
        self._stealth = stealth
        self._web_agent_model = web_agent_model
        self._cache_dir = cache_dir
        self._browser_log_to_file = browser_log_to_file
        self._default_start_url = default_start_url
        self._session_id = session_id or "default"

        # Store timeout configuration
        self._default_timeout = default_timeout
        self._short_timeout = short_timeout
        self._navigation_timeout = ConfigLoader.get_navigation_timeout(navigation_timeout)
        self._network_idle_timeout = ConfigLoader.get_network_idle_timeout(network_idle_timeout)
        self._screenshot_timeout = ConfigLoader.get_screenshot_timeout(screenshot_timeout)
        self._page_stability_timeout = ConfigLoader.get_page_stability_timeout(page_stability_timeout)
        self._dom_content_loaded_timeout = ConfigLoader.get_dom_content_loaded_timeout(dom_content_loaded_timeout)

        # Logging configuration - fixed values for simplicity
        self.enable_action_logging = True
        self.enable_timing_logging = True
        self.enable_page_loading_logging = True
        self.log_to_console = False  # Always disabled for cleaner output
        self.log_to_file = browser_log_to_file
        self.max_log_length = None  # No truncation for file logs

        # Set up log file if needed
        if self.log_to_file:
            # Create log directory if it doesn't exist
            log_dir = "browser_log"
            os.makedirs(log_dir, exist_ok=True)

            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            self.log_file_path: str | None = os.path.join(
                log_dir, f"hybrid_browser_toolkit_{timestamp}_{session_id}.log"
            )
        else:
            self.log_file_path = None

        # Initialize log buffer for in-memory storage
        self.log_buffer: List[Dict[str, Any]] = []

        # Configure enabled tools
        if enabled_tools is None:
            self.enabled_tools = self.DEFAULT_TOOLS.copy()
        else:
            # Validate enabled tools
            invalid_tools = [tool for tool in enabled_tools if tool not in self.ALL_TOOLS]
            if invalid_tools:
                raise ValueError(f"Invalid tools specified: {invalid_tools}. Available tools: {self.ALL_TOOLS}")
            self.enabled_tools = enabled_tools.copy()

        logger.info(f"Enabled tools: {self.enabled_tools}")

        # Log initialization if file logging is enabled
        if self.log_to_file:
            logger.info("HybridBrowserToolkit initialized with file logging enabled")
            logger.info(f"Log file path: {self.log_file_path}")

        # Core components
        temp_session = BrowserSession(
            headless=headless,
            user_data_dir=user_data_dir,
            stealth=stealth,
            session_id=session_id,
            default_timeout=default_timeout,
            short_timeout=short_timeout,
        )

        # Use the session directly - singleton logic is handled in
        # ensure_browser
        self._session = temp_session
        self._agent: PlaywrightLLMAgent | None = None
        self._unified_script = self._load_unified_analyzer()

    @listen_toolkit(BaseHybridBrowserToolkit.browser_visit_page, lambda _, url: url)
    async def browser_visit_page(self, url: str) -> Dict[str, Any]:
        r"""Navigates to a URL.

        This method creates a new tab for the URL instead of navigating
        in the current tab, allowing better multi-tab management.

        Args:
            url (str): The web address to load in the browser.

        Returns:
            Dict[str, Any]: A dictionary containing the result, snapshot, and
                tab information.
        """
        if not url or not isinstance(url, str):
            return {
                "result": "Error: 'url' must be a non-empty string",
                "snapshot": "",
                "tabs": [],
                "current_tab": 0,
                "total_tabs": 1,
            }

        if "://" not in url:
            url = f"https://{url}"

        await self._ensure_browser()
        session = await self._get_session()

        nav_result = ""

        logger.info(f"Navigating to URL in current tab: {url}")

        if not (await session.get_page()).url.startswith("about:blank"):
            await session.get_new_tab()

        nav_result = await session.visit(url)

        # Get snapshot
        snapshot = ""
        try:
            snapshot = await session.get_snapshot(force_refresh=True, diff_only=False)
        except Exception as e:
            logger.warning(f"Failed to capture snapshot: {e}")

        # Get tab information
        tab_info = await self._get_tab_info_for_output()

        return {"result": nav_result, "snapshot": snapshot, **tab_info}

    @classmethod
    def get_can_use_tools(cls, api_task_id: str) -> list[FunctionTool]:
        browser = HybridBrowserPythonToolkit(
            api_task_id,
            headless=False,
            browser_log_to_file=True,
            stealth=True,
            session_id=str(uuid.uuid4())[:8],
            default_start_url="about:blank",
        )

        base_tools = [
            FunctionTool(browser.browser_click),
            FunctionTool(browser.browser_type),
            FunctionTool(browser.browser_back),
            FunctionTool(browser.browser_forward),
            FunctionTool(browser.browser_switch_tab),
            FunctionTool(browser.browser_enter),
            FunctionTool(browser.browser_visit_page),
            FunctionTool(browser.browser_scroll),
            FunctionTool(browser.browser_get_som_screenshot),
            # FunctionTool(browser.select),
            # FunctionTool(browser.wait_user),
        ]

        if browser.web_agent_model is not None:
            base_tools.append(FunctionTool(browser.browser_solve_task))

        return base_tools

    @classmethod
    def toolkit_name(cls) -> str:
        return "Browser Toolkit"

    def clone_for_new_session(self, new_session_id: str | None = None) -> "HybridBrowserPythonToolkit":
        if new_session_id is None:
            new_session_id = str(uuid.uuid4())[:8]

        return HybridBrowserPythonToolkit(
            self.api_task_id,
            headless=self._headless,
            user_data_dir=self._user_data_dir,
            stealth=self._stealth,
            web_agent_model=self._web_agent_model,
            cache_dir=f"{self._cache_dir.rstrip('/')}_clone_{new_session_id}/",
            enabled_tools=self.enabled_tools.copy(),
            browser_log_to_file=self._browser_log_to_file,
            session_id=new_session_id,
            default_start_url=self._default_start_url,
            default_timeout=self._default_timeout,
            short_timeout=self._short_timeout,
            navigation_timeout=self._navigation_timeout,
            network_idle_timeout=self._network_idle_timeout,
            screenshot_timeout=self._screenshot_timeout,
            page_stability_timeout=self._page_stability_timeout,
            dom_content_loaded_timeout=self._dom_content_loaded_timeout,
        )

    async def _get_session(self) -> BrowserSession:
        return await super()._get_session()  # type: ignore
