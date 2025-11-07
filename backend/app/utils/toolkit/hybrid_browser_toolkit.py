import os
import subprocess
import time
import asyncio
import json
from typing import Any, Dict, List, Optional
import websockets
import websockets.exceptions

from camel.models import BaseModelBackend
from camel.toolkits.hybrid_browser_toolkit.hybrid_browser_toolkit_ts import (
    HybridBrowserToolkit as BaseHybridBrowserToolkit,
)
from camel.toolkits.hybrid_browser_toolkit.ws_wrapper import WebSocketBrowserWrapper as BaseWebSocketBrowserWrapper
from app.component.command import bun, uv
from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("hybrid_browser_toolkit")


class WebSocketBrowserWrapper(BaseWebSocketBrowserWrapper):
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """Initialize wrapper."""
        super().__init__(config)
        logger.info(f"WebSocketBrowserWrapper using ts_dir: {self.ts_dir}")

    async def _receive_loop(self):
        """Background task to receive messages from WebSocket with enhanced logging."""
        logger.debug("WebSocket receive loop started")
        disconnect_reason = None

        try:
            while self.websocket:
                try:
                    response_data = await self.websocket.recv()
                    response = json.loads(response_data)

                    message_id = response.get("id")
                    if message_id and message_id in self._pending_responses:
                        # Set the result for the waiting coroutine
                        future = self._pending_responses.pop(message_id)
                        if not future.done():
                            future.set_result(response)
                            logger.debug(f"Processed response for message {message_id}")
                    else:
                        message_summary = {
                            "id": response.get("id"),
                            "success": response.get("success"),
                            "has_result": "result" in response,
                            "result_type": type(response.get("result")).__name__ if "result" in response else None
                        }
                        logger.debug(f"Received unexpected message: {message_summary}")

                except asyncio.CancelledError:
                    disconnect_reason = "Receive loop cancelled"
                    logger.info(f"WebSocket disconnect: {disconnect_reason}")
                    break
                except websockets.exceptions.ConnectionClosed as e:
                    disconnect_reason = f"WebSocket closed: code={e.code}, reason={e.reason}"
                    logger.warning(f"WebSocket disconnect: {disconnect_reason}")
                    break
                except websockets.exceptions.WebSocketException as e:
                    disconnect_reason = f"WebSocket error: {type(e).__name__}: {e}"
                    logger.error(f"WebSocket disconnect: {disconnect_reason}")
                    break
                except json.JSONDecodeError as e:
                    logger.error(f"Failed to decode WebSocket message: {e}")
                    continue  # Try to continue on JSON errors
                except Exception as e:
                    disconnect_reason = f"Unexpected error: {type(e).__name__}: {e}"
                    logger.error(f"WebSocket disconnect: {disconnect_reason}", exc_info=True)
                    # Notify all pending futures of the error
                    for future in self._pending_responses.values():
                        if not future.done():
                            future.set_exception(e)
                    self._pending_responses.clear()
                    break
        finally:
            logger.info(f"WebSocket receive loop terminated. Reason: {disconnect_reason or 'Normal shutdown'}")
            # Mark the websocket as None to indicate disconnection
            self.websocket = None

    async def start(self):
        # Simply use the parent implementation which uses system npm/node
        logger.info("Starting WebSocket server using parent implementation (system npm/node)")
        await super().start()

    async def _send_command(self, command: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Send a command to the WebSocket server with enhanced error handling."""
        try:
            # First ensure we have a valid connection
            if self.websocket is None:
                raise RuntimeError("WebSocket connection not established")

            # Check connection state before sending
            if hasattr(self.websocket, "state"):
                import websockets.protocol

                if self.websocket.state != websockets.protocol.State.OPEN:
                    raise RuntimeError(f"WebSocket is in {self.websocket.state} state, not OPEN")

            logger.debug(f"Sending command '{command}' with params: {params}")

            # Call parent's _send_command
            result = await super()._send_command(command, params)

            logger.debug(f"Command '{command}' completed successfully")
            return result

        except RuntimeError as e:
            logger.error(f"Failed to send command '{command}': {e}")
            # Check if it's a connection issue
            if "WebSocket" in str(e) or "connection" in str(e).lower():
                # Mark connection as dead
                self.websocket = None
            raise
        except Exception as e:
            logger.error(f"Unexpected error sending command '{command}': {type(e).__name__}: {e}")
            raise


# WebSocket connection pool
class WebSocketConnectionPool:
    """Manage WebSocket browser connections with session-based pooling."""

    def __init__(self):
        self._connections: Dict[str, WebSocketBrowserWrapper] = {}
        self._lock = asyncio.Lock()

    async def get_connection(self, session_id: str, config: Dict[str, Any]) -> WebSocketBrowserWrapper:
        """Get or create a connection for the given session ID."""
        async with self._lock:
            # Check if we have an existing connection for this session
            if session_id in self._connections:
                wrapper = self._connections[session_id]

                # Comprehensive connection health check
                is_healthy = False
                if wrapper.websocket:
                    try:
                        # Check WebSocket state based on available attributes
                        if hasattr(wrapper.websocket, "state"):
                            import websockets.protocol

                            is_healthy = wrapper.websocket.state == websockets.protocol.State.OPEN
                            if not is_healthy:
                                logger.debug(f"Session {session_id} WebSocket state: {wrapper.websocket.state}")
                        elif hasattr(wrapper.websocket, "open"):
                            is_healthy = wrapper.websocket.open
                        else:
                            # Try ping as last resort
                            try:
                                await asyncio.wait_for(wrapper.websocket.ping(), timeout=1.0)
                                is_healthy = True
                            except:
                                is_healthy = False
                    except Exception as e:
                        logger.debug(f"Health check failed for session {session_id}: {e}")
                        is_healthy = False

                if is_healthy:
                    logger.debug(f"Reusing healthy WebSocket connection for session {session_id}")
                    return wrapper
                else:
                    # Connection is unhealthy, clean it up
                    logger.info(f"Removing unhealthy WebSocket connection for session {session_id}")
                    try:
                        await wrapper.stop()
                    except Exception as e:
                        logger.debug(f"Error stopping unhealthy wrapper: {e}")
                    del self._connections[session_id]

            # Create a new connection
            logger.info(f"Creating new WebSocket connection for session {session_id}")
            wrapper = WebSocketBrowserWrapper(config)
            await wrapper.start()
            self._connections[session_id] = wrapper
            logger.info(f"Successfully created WebSocket connection for session {session_id}")
            return wrapper

    async def close_connection(self, session_id: str):
        """Close and remove a connection for the given session ID."""
        async with self._lock:
            if session_id in self._connections:
                wrapper = self._connections[session_id]
                try:
                    await wrapper.stop()
                except Exception as e:
                    logger.error(f"Error closing WebSocket connection for session {session_id}: {e}")
                del self._connections[session_id]
                logger.info(f"Closed WebSocket connection for session {session_id}")

    async def _close_connection_unlocked(self, session_id: str):
        """Close connection without acquiring lock (for internal use)."""
        if session_id in self._connections:
            wrapper = self._connections[session_id]
            try:
                await wrapper.stop()
            except Exception as e:
                logger.error(f"Error closing WebSocket connection for session {session_id}: {e}")
            del self._connections[session_id]
            logger.info(f"Closed WebSocket connection for session {session_id}")

    async def close_all(self):
        """Close all connections in the pool."""
        async with self._lock:
            for session_id in list(self._connections.keys()):
                await self._close_connection_unlocked(session_id)
            logger.info("Closed all WebSocket connections")


# Global connection pool instance
websocket_connection_pool = WebSocketConnectionPool()


@auto_listen_toolkit(BaseHybridBrowserToolkit)
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
        cache_dir: Optional[str] = None,
        enabled_tools: List[str] | None = None,
        browser_log_to_file: bool = False,
        log_dir: Optional[str] = None,
        session_id: str | None = None,
        default_start_url: Optional[str] = None,
        default_timeout: int | None = None,
        short_timeout: int | None = None,
        navigation_timeout: int | None = None,
        network_idle_timeout: int | None = None,
        screenshot_timeout: int | None = None,
        page_stability_timeout: int | None = None,
        dom_content_loaded_timeout: int | None = None,
        viewport_limit: bool = False,
        connect_over_cdp: bool = True,
        cdp_url: str | None = "http://localhost:9222",
        cdp_keep_current_page: bool = False,
        full_visual_mode: bool = False,
    ) -> None:
        logger.info(f"[HybridBrowserToolkit] Initializing with api_task_id: {api_task_id}")
        self.api_task_id = api_task_id
        logger.debug(f"[HybridBrowserToolkit] api_task_id set to: {self.api_task_id}")
        logger.debug(f"[HybridBrowserToolkit] Calling super().__init__ with session_id: {session_id}")
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
            cdp_keep_current_page=cdp_keep_current_page,
            full_visual_mode=full_visual_mode,
        )
        logger.info(f"[HybridBrowserToolkit] Initialization complete for api_task_id: {self.api_task_id}")

    async def _ensure_ws_wrapper(self):
        """Ensure WebSocket wrapper is initialized using connection pool."""
        logger.debug(f"[HybridBrowserToolkit] _ensure_ws_wrapper called for api_task_id: {getattr(self, 'api_task_id', 'NOT SET')}")
        global websocket_connection_pool

        # Get session ID from config or use default
        session_id = self._ws_config.get("session_id", "default")
        logger.debug(f"[HybridBrowserToolkit] Using session_id: {session_id}")

        # Get or create connection from pool
        self._ws_wrapper = await websocket_connection_pool.get_connection(session_id, self._ws_config)
        logger.info(f"[HybridBrowserToolkit] WebSocket wrapper initialized for session: {session_id}")

        # Additional health check
        if self._ws_wrapper.websocket is None:
            logger.warning(f"WebSocket connection for session {session_id} is None after pool retrieval, recreating...")
            await websocket_connection_pool.close_connection(session_id)
            self._ws_wrapper = await websocket_connection_pool.get_connection(session_id, self._ws_config)

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
            log_dir=self.config_loader.get_toolkit_config().log_dir,
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
            cdp_url=f"http://localhost:{env('browser_port', '9222')}",
            cdp_keep_current_page=self.config_loader.get_browser_config().cdp_keep_current_page,
            full_visual_mode=self._full_visual_mode,
        )

    @classmethod
    def toolkit_name(cls) -> str:
        return "Browser Toolkit"

    async def close(self):
        """Close the browser toolkit and release WebSocket connection."""
        try:
            # Close browser if needed
            if self._ws_wrapper:
                await super().browser_close()
        except Exception as e:
            logger.error(f"Error closing browser: {e}")

        # Release connection from pool
        session_id = self._ws_config.get("session_id", "default")
        await websocket_connection_pool.close_connection(session_id)
        logger.info(f"Released WebSocket connection for session {session_id}")

    def __del__(self):
        """Cleanup when object is garbage collected."""
        if hasattr(self, "_ws_wrapper") and self._ws_wrapper:
            session_id = self._ws_config.get("session_id", "default")
            logger.debug(f"HybridBrowserToolkit for session {session_id} is being garbage collected")
