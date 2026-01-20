import os
import asyncio
import json
import uuid
from typing import Any, Dict, List, Optional
from typing_extensions import TypedDict
import websockets
import websockets.exceptions

from camel.toolkits.hybrid_browser_toolkit.hybrid_browser_toolkit_ts import (
    HybridBrowserToolkit as BaseHybridBrowserToolkit,
)
from camel.toolkits.hybrid_browser_toolkit.ws_wrapper import WebSocketBrowserWrapper as BaseWebSocketBrowserWrapper
from app.component.command import bun, uv
from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
import logging

logger = logging.getLogger("hybrid_browser_toolkit")

# Global navigation lock to prevent concurrent visit_page conflicts (ERR_ABORTED)
# This is needed because multiple sessions may share the same browser via CDP
_global_navigation_lock = asyncio.Lock()

# Global registry: tab_id -> session_id (ensures each tab belongs to only one session)
_global_tab_registry: Dict[str, str] = {}
_global_tab_registry_lock = asyncio.Lock()


class SheetCell(TypedDict):
    row: int
    col: int
    text: str


class WebSocketBrowserWrapper(BaseWebSocketBrowserWrapper):
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """Initialize wrapper."""
        super().__init__(config)
        logger.info(f"WebSocketBrowserWrapper using ts_dir: {self.ts_dir}")
        # Track tabs opened by this session for isolation
        self._session_tab_ids: set = set()
        self._wrapper_session_id: str = str(uuid.uuid4())

    def _ensure_local_no_proxy(self) -> None:
        local_hosts = ["localhost", "127.0.0.1", "::1"]
        for key in ("NO_PROXY", "no_proxy"):
            current = os.environ.get(key, "")
            if not current:
                os.environ[key] = ",".join(local_hosts)
                continue
            parts = [item.strip() for item in current.split(",") if item.strip()]
            updated = False
            for host in local_hosts:
                if host not in parts:
                    parts.append(host)
                    updated = True
            if updated:
                os.environ[key] = ",".join(parts)

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
        self._ensure_local_no_proxy()
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

    async def visit_page(self, url: str) -> Dict[str, Any]:
        """Override visit_page to add global navigation lock preventing ERR_ABORTED.

        Multiple sessions sharing the same browser via CDP can cause conflicts
        when they try to navigate simultaneously (e.g., both trying to use a
        blank page). This lock serializes navigation operations at the WebSocket
        wrapper level.
        """
        global _global_navigation_lock

        async with _global_navigation_lock:
            logger.debug(f"[visit_page] Acquired navigation lock, navigating to {url}")
            try:
                result = await super().visit_page(url)
                logger.debug(f"[visit_page] Navigation completed, releasing lock")
                return result
            except Exception as e:
                logger.error(f"[visit_page] Navigation failed: {e}")
                raise

    async def get_tab_info(self) -> List[Dict[str, Any]]:
        """Override get_tab_info to track and filter tabs for session isolation.

        Automatically tracks the current tab (is_current=true) as belonging to
        this session, then filters to only return tabs owned by this session.
        Uses global registry to ensure each tab belongs to only one session.
        """
        global _global_tab_registry, _global_tab_registry_lock

        all_tabs = await super().get_tab_info()
        session_id = self._wrapper_session_id  # Stable UUID for this wrapper

        # Auto-track: add current tab to this session's tracked tabs (with global lock)
        current_tab = next((t for t in all_tabs if t.get('is_current')),
                           None)
        if current_tab and current_tab.get('tab_id'):
            tab_id = current_tab['tab_id']
            async with _global_tab_registry_lock:
                # Only track if not already owned by another session
                if tab_id not in _global_tab_registry:
                    _global_tab_registry[tab_id] = session_id
                    self._session_tab_ids.add(tab_id)
                    logger.info(
                        f"[Session Tab Tracking] Auto-tracked current tab: {tab_id}, session {session_id} now has tabs: {self._session_tab_ids}")
                elif _global_tab_registry[tab_id] == session_id:
                    # Already owned by this session, ensure local tracking
                    self._session_tab_ids.add(tab_id)

        # Filter: only return tabs belonging to this session
        filtered_tabs = [tab for tab in all_tabs if
                         tab.get('tab_id') in self._session_tab_ids]
        logger.info(
            f"[Session Tab Filtering] Session {session_id}: Returning {len(filtered_tabs)}/{len(all_tabs)} tabs, tracked: {self._session_tab_ids}")

        return filtered_tabs

    async def close_tab(self, tab_id: str) -> Dict[str, Any]:
        """Override close_tab to update tracking."""
        global _global_tab_registry, _global_tab_registry_lock

        result = await super().close_tab(tab_id)

        # Remove from tracking if it was ours
        if tab_id in self._session_tab_ids:
            self._session_tab_ids.discard(tab_id)
            async with _global_tab_registry_lock:
                if tab_id in _global_tab_registry:
                    del _global_tab_registry[tab_id]
            logger.info(
                f"[Session Tab Tracking] Removed closed tab: {tab_id}, session now has tabs: {self._session_tab_ids}")

        return result

    async def cleanup_tab_tracking(self):
        """Clean up all tab tracking for this session from the global registry.

        Should be called when the wrapper is being stopped/destroyed to prevent
        memory leaks and stale entries in the global registry.
        """
        global _global_tab_registry, _global_tab_registry_lock

        if not self._session_tab_ids:
            return

        async with _global_tab_registry_lock:
            cleaned_count = len(self._session_tab_ids)
            for tab_id in list(self._session_tab_ids):
                if tab_id in _global_tab_registry:
                    del _global_tab_registry[tab_id]
            # Clear inside lock to prevent race with concurrent get_tab_info
            self._session_tab_ids.clear()
            logger.info(
                f"[Session Tab Tracking] Cleaned up {cleaned_count} tabs for session {self._wrapper_session_id}")


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
                        await wrapper.cleanup_tab_tracking()
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
                    await wrapper.cleanup_tab_tracking()
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
                await wrapper.cleanup_tab_tracking()
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
    agent_name: str = Agents.browser_agent

    def __init__(
        self,
        api_task_id: str,
        *,
        headless: bool = False,
        user_data_dir: str | None = None,
        stealth: bool = True,
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
        
        # Set default user_data_dir if not provided
        if user_data_dir is None:
            # Use browser port to determine profile directory
            browser_port = env('browser_port', '9222')
            user_data_base = os.path.expanduser("~/.eigent/browser_profiles")
            user_data_dir = os.path.join(user_data_base, f"profile_{browser_port}")
            os.makedirs(user_data_dir, exist_ok=True)
            logger.info(f"[HybridBrowserToolkit] Using port-based user_data_dir: {user_data_dir} (port: {browser_port})")
        else:
            logger.info(f"[HybridBrowserToolkit] Using provided user_data_dir: {user_data_dir}")

        logger.debug(f"[HybridBrowserToolkit] Calling super().__init__ with session_id: {session_id}")
        super().__init__(
            headless=headless,
            user_data_dir=user_data_dir,
            stealth=stealth,
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

        # Log when connecting to browser
        cdp_url = self._ws_config.get("cdp_url", f"http://localhost:{env('browser_port', '9222')}")
        logger.info(f"[PROJECT BROWSER] Connecting to browser via CDP at {cdp_url}")

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

        # For cloned sessions, use the same user_data_dir to share login state
        # This allows multiple agents to use the same browser profile without conflicts
        logger.info(f"Cloning session {new_session_id} with shared user_data_dir: {self._user_data_dir}")

        # Use the same session_id to share the same browser instance
        # This ensures all clones use the same WebSocket connection and browser
        return HybridBrowserToolkit(
            self.api_task_id,
            headless=self._headless,
            user_data_dir=self._user_data_dir,  # Use the same user_data_dir
            stealth=self._stealth,
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

    async def browser_sheet_input(self, *, cells: List[SheetCell]) -> Dict[str, Any]:
        # Use typing_extensions.TypedDict for Pydantic <3.12 compatibility.
        return await super().browser_sheet_input(cells=cells)

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
