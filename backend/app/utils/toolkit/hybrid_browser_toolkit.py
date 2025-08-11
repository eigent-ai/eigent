import os
import subprocess
import time
from typing import Any, Dict, List
from camel.models import BaseModelBackend
from camel.toolkits.hybrid_browser_toolkit.hybrid_browser_toolkit_ts import (
    HybridBrowserToolkit as BaseHybridBrowserToolkit,
)
from camel.toolkits.hybrid_browser_toolkit.ws_wrapper import WebSocketBrowserWrapper as BaseWebSocketBrowserWrapper
from loguru import logger
import websockets
from app.component.command import bun, uv
from app.service.task import Agents
from app.utils.listen.toolkit_listen import listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


class WebSocketBrowserWrapper(BaseWebSocketBrowserWrapper):
    async def start(self):
        # Check if node_modules exists (dependencies installed)
        node_modules_path = os.path.join(self.ts_dir, "node_modules")
        if not os.path.exists(node_modules_path):
            logger.warning("Node modules not found. Running npm install...")
            install_result = subprocess.run(
                [uv(), "run", "npm", "install"],
                cwd=self.ts_dir,
                capture_output=True,
                text=True,
            )
            if install_result.returncode != 0:
                logger.error(f"npm install failed: {install_result.stderr}")
                raise RuntimeError(
                    f"Failed to install npm dependencies: {install_result.stderr}\n"  # noqa:E501
                    f"Please run 'npm install' in {self.ts_dir} manually."
                )
            logger.info("npm dependencies installed successfully")

        # Ensure the TypeScript code is built
        build_result = subprocess.run(
            [uv(), "run", "npm", "run", "build"],
            cwd=self.ts_dir,
            capture_output=True,
            text=True,
        )
        if build_result.returncode != 0:
            logger.error(f"TypeScript build failed: {build_result.stderr}")
            raise RuntimeError(f"TypeScript build failed: {build_result.stderr}")

        # Start the WebSocket server
        self.process = subprocess.Popen(
            [uv(), "run", "node", "websocket-server.js"],  # bun not support playwright, use uv nodejs-bin
            cwd=self.ts_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

        # Wait for server to output the port
        server_ready = False
        timeout = 10  # 10 seconds timeout
        start_time = time.time()

        while not server_ready and time.time() - start_time < timeout:
            if self.process.poll() is not None:
                # Process died
                stderr = self.process.stderr.read()  # type: ignore
                raise RuntimeError(f"WebSocket server failed to start: {stderr}")

            try:
                line = self.process.stdout.readline()  # type: ignore
                logger.debug(f"WebSocket server output: {line}")
                if line.startswith("SERVER_READY:"):
                    self.server_port = int(line.split(":")[1].strip())
                    server_ready = True
                    logger.info(f"WebSocket server ready on port {self.server_port}")
            except (ValueError, IndexError):
                continue

        if not server_ready:
            self.process.kill()
            raise RuntimeError("WebSocket server failed to start within timeout")

        # Connect to the WebSocket server
        try:
            self.websocket = await websockets.connect(
                f"ws://localhost:{self.server_port}",
                ping_interval=30,
                ping_timeout=10,
                max_size=50 * 1024 * 1024,  # 50MB limit to match server
            )
            logger.info("Connected to WebSocket server")
        except Exception as e:
            self.process.kill()
            raise RuntimeError(f"Failed to connect to WebSocket server: {e}") from e

        # Initialize the browser toolkit
        logger.debug(f"send init {self.config}")
        await self._send_command("init", self.config)
        logger.debug("WebSocket server initialized successfully")


websocket_browser_wrapper = None
"""ensure only one instance of websocket_browser_wrapper"""


class HybridBrowserToolkit(BaseHybridBrowserToolkit, AbstractToolkit):
    agent_name: str = Agents.search_agent

    def __init__(
        self,
        api_task_id: str,
        *,
        headless: bool = False,
        user_data_dir: str | None = None,
        stealth: bool = True,
        web_agent_model: BaseModelBackend | None = None,
        cache_dir: str = "tmp/",
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
        viewport_limit: bool = False,
        connect_over_cdp: bool = False,
        cdp_url: str | None = None,
    ) -> None:
        self.api_task_id = api_task_id
        super().__init__(
            headless=headless,
            user_data_dir=user_data_dir,
            stealth=stealth,
            web_agent_model=web_agent_model,
            cache_dir=cache_dir,
            enabled_tools=enabled_tools,
            browser_log_to_file=browser_log_to_file,
            session_id=session_id,
            default_start_url=default_start_url,
            default_timeout=default_timeout,
            short_timeout=short_timeout,
            navigation_timeout=navigation_timeout,
            network_idle_timeout=network_idle_timeout,
            screenshot_timeout=screenshot_timeout,
            page_stability_timeout=page_stability_timeout,
            dom_content_loaded_timeout=dom_content_loaded_timeout,
            viewport_limit=viewport_limit,
            connect_over_cdp=connect_over_cdp,
            cdp_url=cdp_url,
        )

    async def _ensure_ws_wrapper(self):
        """Ensure WebSocket wrapper is initialized."""
        if self._ws_wrapper is None:
            global websocket_browser_wrapper
            if websocket_browser_wrapper is None:
                websocket_browser_wrapper = WebSocketBrowserWrapper(self._ws_config)
            self._ws_wrapper = websocket_browser_wrapper
            await self._ws_wrapper.start()

    def clone_for_new_session(self, new_session_id: str | None = None) -> "HybridBrowserToolkit":
        import uuid

        if new_session_id is None:
            new_session_id = str(uuid.uuid4())[:8]

        return HybridBrowserToolkit(
            self.api_task_id,
            headless=self._headless,
            user_data_dir=self._user_data_dir,
            stealth=self._stealth,
            web_agent_model=self._web_agent_model,
            cache_dir=f"{self._cache_dir.rstrip('/')}/_clone_{new_session_id}/",
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
            viewport_limit=self._viewport_limit,
            connect_over_cdp=self.config_loader.get_browser_config().connect_over_cdp,
            cdp_url=self.config_loader.get_browser_config().cdp_url,
        )

    @classmethod
    def toolkit_name(cls) -> str:
        return "Browser Toolkit"

    @listen_toolkit(BaseHybridBrowserToolkit.browser_open)
    async def browser_open(self) -> Dict[str, Any]:
        return await super().browser_open()

    @listen_toolkit(BaseHybridBrowserToolkit.browser_close)
    async def browser_close(self) -> str:
        return await super().browser_close()

    @listen_toolkit(BaseHybridBrowserToolkit.browser_visit_page)
    async def browser_visit_page(self, url: str) -> Dict[str, Any]:
        return await super().browser_visit_page(url)

    @listen_toolkit(BaseHybridBrowserToolkit.browser_back)
    async def browser_back(self) -> Dict[str, Any]:
        return await super().browser_back()

    @listen_toolkit(BaseHybridBrowserToolkit.browser_forward)
    async def browser_forward(self) -> Dict[str, Any]:
        return await super().browser_forward()

    @listen_toolkit(BaseHybridBrowserToolkit.browser_get_page_snapshot)
    async def browser_get_page_snapshot(self) -> str:
        return await super().browser_get_page_snapshot()

    @listen_toolkit(BaseHybridBrowserToolkit.browser_get_som_screenshot)
    async def browser_get_som_screenshot(self, read_image: bool = False, instruction: str | None = None) -> str:
        return await super().browser_get_som_screenshot(read_image, instruction)

    @listen_toolkit(BaseHybridBrowserToolkit.browser_click)
    async def browser_click(self, *, ref: str) -> Dict[str, Any]:
        return await super().browser_click(ref=ref)

    @listen_toolkit(BaseHybridBrowserToolkit.browser_type)
    async def browser_type(self, *, ref: str, text: str) -> Dict[str, Any]:
        return await super().browser_type(ref=ref, text=text)

    @listen_toolkit(BaseHybridBrowserToolkit.browser_select)
    async def browser_select(self, *, ref: str, value: str) -> Dict[str, Any]:
        return await super().browser_select(ref=ref, value=value)

    @listen_toolkit(BaseHybridBrowserToolkit.browser_scroll)
    async def browser_scroll(self, *, direction: str, amount: int = 500) -> Dict[str, Any]:
        return await super().browser_scroll(direction=direction, amount=amount)

    @listen_toolkit(BaseHybridBrowserToolkit.browser_enter)
    async def browser_enter(self) -> Dict[str, Any]:
        return await super().browser_enter()

    @listen_toolkit(BaseHybridBrowserToolkit.browser_wait_user)
    async def browser_wait_user(self, timeout_sec: float | None = None) -> Dict[str, Any]:
        return await super().browser_wait_user(timeout_sec)

    @listen_toolkit(BaseHybridBrowserToolkit.browser_switch_tab)
    async def browser_switch_tab(self, *, tab_id: str) -> Dict[str, Any]:
        return await super().browser_switch_tab(tab_id=tab_id)

    @listen_toolkit(BaseHybridBrowserToolkit.browser_close_tab)
    async def browser_close_tab(self, *, tab_id: str) -> Dict[str, Any]:
        return await super().browser_close_tab(tab_id=tab_id)

    @listen_toolkit(BaseHybridBrowserToolkit.browser_get_tab_info)
    async def browser_get_tab_info(self) -> Dict[str, Any]:
        return await super().browser_get_tab_info()
