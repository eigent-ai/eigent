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

import asyncio
import json
import logging
import os
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import websockets
import websockets.exceptions
from camel.toolkits.hybrid_browser_toolkit.hybrid_browser_toolkit_ts import (
    HybridBrowserToolkit as BaseHybridBrowserToolkit,
)
from camel.toolkits.hybrid_browser_toolkit.ws_wrapper import (
    WebSocketBrowserWrapper as BaseWebSocketBrowserWrapper,
)
from typing_extensions import TypedDict

from app.agent.toolkit.abstract_toolkit import AbstractToolkit
from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit

logger = logging.getLogger("hybrid_browser_toolkit")

# Navigation locks prevent concurrent visit_page conflicts (ERR_ABORTED) for
# sessions sharing the same browser/CDP endpoint.
_navigation_locks: dict[str, asyncio.Lock] = {}
_navigation_locks_guard = asyncio.Lock()
_browser_bringup_locks: dict[str, asyncio.Lock] = {}
_browser_bringup_locks_guard = asyncio.Lock()
_node_runtime_hook_lock = asyncio.Lock()

# Global registry: (CDP endpoint, tab_id) -> session_id. Namespacing prevents
# unrelated browser instances from consuming each other's tab budget.
_global_tab_registry: dict[tuple[str, str], str] = {}
_global_tab_registry_lock = asyncio.Lock()

_DEFAULT_MAX_SESSION_TABS = 4
_DEFAULT_MAX_MANAGED_TABS_PER_ENDPOINT = 8


def _timeout_value_to_seconds(value: Any, *, fallback_seconds: float) -> float:
    if value is None:
        return fallback_seconds
    try:
        timeout = float(value)
    except (TypeError, ValueError):
        return fallback_seconds
    if timeout <= 0:
        return fallback_seconds
    # CAMEL browser timeout config is in milliseconds; local overrides may be
    # provided in seconds. Values above 300 are treated as milliseconds.
    if timeout > 300:
        timeout = timeout / 1000.0
    return timeout


def _env_timeout_seconds(name: str, fallback_seconds: float) -> float:
    return _timeout_value_to_seconds(
        env(name, ""), fallback_seconds=fallback_seconds
    )


def _env_positive_int(name: str, fallback: int) -> int:
    raw_value = env(name, "").strip()
    if not raw_value:
        return fallback
    try:
        value = int(raw_value)
    except ValueError:
        logger.warning("Invalid %s=%r; using %s", name, raw_value, fallback)
        return fallback
    if value < 1:
        logger.warning("Invalid %s=%r; using %s", name, raw_value, fallback)
        return fallback
    return value


def _endpoint_lock_key(cdp_url: str | None) -> str:
    if cdp_url:
        parsed = urlparse(cdp_url)
        if parsed.netloc:
            return parsed.netloc
        if parsed.path:
            return parsed.path
    return f"localhost:{env('browser_port', '9222')}"


async def _get_navigation_lock(key: str) -> asyncio.Lock:
    async with _navigation_locks_guard:
        lock = _navigation_locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            _navigation_locks[key] = lock
        return lock


async def _get_browser_bringup_lock(key: str) -> asyncio.Lock:
    async with _browser_bringup_locks_guard:
        lock = _browser_bringup_locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            _browser_bringup_locks[key] = lock
        return lock


class SheetCell(TypedDict):
    row: int
    col: int
    text: str


class WebSocketBrowserWrapper(BaseWebSocketBrowserWrapper):
    def __init__(self, config: dict[str, Any] | None = None):
        """Initialize wrapper."""
        super().__init__(config)
        logger.info(f"WebSocketBrowserWrapper using ts_dir: {self.ts_dir}")
        # Track tabs opened by this session for isolation
        self._session_tab_ids: set[str] = set()
        # Oldest-to-newest access order. This lets us recycle an Eigent-owned
        # background page without ever closing a user's unrelated Chrome tab.
        self._session_tab_order: list[str] = []
        self._wrapper_session_id: str = str(uuid.uuid4())

    def _fail_all_pending(self, exc: Exception) -> None:
        for future in self._pending_responses.values():
            if not future.done():
                future.set_exception(exc)
        self._pending_responses.clear()

    def _command_timeout_seconds(self, command: str) -> float:
        override = env("BROWSER_COMMAND_TIMEOUT_SECONDS", "").strip()
        if override:
            return _timeout_value_to_seconds(
                override, fallback_seconds=self._request_timeout
            )

        command_name = command.lower()
        if any(
            token in command_name
            for token in ("visit", "navigate", "open", "reload", "wait")
        ):
            return _timeout_value_to_seconds(
                self.config.get("navigationTimeout"),
                fallback_seconds=self._request_timeout,
            )
        return _timeout_value_to_seconds(
            self.config.get("defaultTimeout"),
            fallback_seconds=self._request_timeout,
        )

    def _navigation_lock_key(self) -> str:
        cdp_url = str(self.config.get("cdpUrl") or "").strip()
        return _endpoint_lock_key(cdp_url)

    def _navigation_lock_wait_seconds(self) -> float:
        command_timeout = self._command_timeout_seconds("visit_page")
        return _env_timeout_seconds(
            "BROWSER_NAVIGATION_LOCK_TIMEOUT_SECONDS",
            fallback_seconds=command_timeout + 5.0,
        )

    def _max_session_tabs(self) -> int:
        return _env_positive_int(
            "EIGENT_BROWSER_MAX_TABS_PER_SESSION",
            _DEFAULT_MAX_SESSION_TABS,
        )

    def _max_managed_tabs_per_endpoint(self) -> int:
        return _env_positive_int(
            "EIGENT_BROWSER_MAX_MANAGED_TABS",
            _DEFAULT_MAX_MANAGED_TABS_PER_ENDPOINT,
        )

    def _tab_registry_key(self, tab_id: str) -> tuple[str, str]:
        return (self._navigation_lock_key(), tab_id)

    def _touch_session_tab(self, tab_id: str) -> None:
        try:
            self._session_tab_order.remove(tab_id)
        except ValueError:
            pass
        self._session_tab_order.append(tab_id)

    def _forget_session_tab(self, tab_id: str) -> None:
        self._session_tab_ids.discard(tab_id)
        try:
            self._session_tab_order.remove(tab_id)
        except ValueError:
            pass

    async def _track_and_limit_tabs(
        self,
        all_tabs: list[dict[str, Any]],
        *,
        reserve_slots: int = 0,
    ) -> list[dict[str, Any]]:
        """Track the active tab and keep Eigent-managed tabs bounded.

        ``reserve_slots=1`` is used before ``visit_page`` because CAMEL opens
        each URL in a new tab. Only tabs owned by this wrapper are eligible for
        recycling; pre-existing user tabs are deliberately left untouched.
        """
        endpoint = self._navigation_lock_key()
        session_id = self._wrapper_session_id
        live_tab_ids = {
            str(tab["tab_id"])
            for tab in all_tabs
            if tab.get("tab_id") is not None
        }
        current_tab = next(
            (tab for tab in all_tabs if tab.get("is_current")), None
        )
        current_tab_id = (
            str(current_tab["tab_id"])
            if current_tab and current_tab.get("tab_id") is not None
            else None
        )

        async with _global_tab_registry_lock:
            # A tab may have been closed by the user or by Chrome while this
            # wrapper was idle. Remove stale ownership before counting limits.
            for key in list(_global_tab_registry):
                if key[0] == endpoint and key[1] not in live_tab_ids:
                    del _global_tab_registry[key]
            for tab_id in list(self._session_tab_ids):
                if tab_id not in live_tab_ids:
                    self._forget_session_tab(tab_id)

            if current_tab_id is not None:
                key = self._tab_registry_key(current_tab_id)
                owner = _global_tab_registry.get(key)
                if owner is None:
                    _global_tab_registry[key] = session_id
                    self._session_tab_ids.add(current_tab_id)
                    self._touch_session_tab(current_tab_id)
                    logger.info(
                        "[Session Tab Tracking] Auto-tracked current tab: %s, "
                        "session %s now has tabs: %s",
                        current_tab_id,
                        session_id,
                        self._session_tab_ids,
                    )
                elif owner == session_id:
                    self._session_tab_ids.add(current_tab_id)
                    self._touch_session_tab(current_tab_id)

            managed_count = sum(
                1 for key in _global_tab_registry if key[0] == endpoint
            )

        session_limit = self._max_session_tabs()
        endpoint_limit = self._max_managed_tabs_per_endpoint()
        recycle_count = max(
            len(self._session_tab_ids) + reserve_slots - session_limit,
            managed_count + reserve_slots - endpoint_limit,
            0,
        )
        if recycle_count == 0:
            return all_tabs

        victim_ids = [
            tab_id
            for tab_id in self._session_tab_order
            if tab_id in live_tab_ids and tab_id != current_tab_id
        ]
        if len(victim_ids) < recycle_count:
            raise RuntimeError(
                "Browser tab limit reached and this session has no inactive "
                "Eigent-managed tab that can be safely recycled "
                f"(session_limit={session_limit}, "
                f"endpoint_limit={endpoint_limit})."
            )

        recycled_ids = victim_ids[:recycle_count]
        for victim_id in recycled_ids:
            logger.warning(
                "[Browser Tab Limit] Recycling least-recently-used tab %s "
                "before opening another page (session=%s, session_limit=%s, "
                "endpoint_limit=%s)",
                victim_id,
                session_id,
                session_limit,
                endpoint_limit,
            )
            await self.close_tab(victim_id)
        return [
            tab
            for tab in all_tabs
            if str(tab.get("tab_id")) not in recycled_ids
        ]

    async def _close_current_websocket(self) -> None:
        websocket = self.websocket
        self.websocket = None
        if websocket is None:
            return
        try:
            await asyncio.wait_for(websocket.close(), timeout=1.0)
        except Exception as exc:
            logger.debug(f"Error closing browser websocket: {exc}")

    def _ensure_local_no_proxy(self) -> None:
        local_hosts = ["localhost", "127.0.0.1", "::1"]
        for key in ("NO_PROXY", "no_proxy"):
            current = env(key, "")
            if not current:
                # Process-level proxy bypass for local CDP/WebSocket traffic.
                # This is intentionally static host configuration, not
                # per-run mutable state like API keys or artifact paths.
                os.environ[key] = ",".join(local_hosts)
                continue
            parts = [
                item.strip() for item in current.split(",") if item.strip()
            ]
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
        pending_error: Exception | None = None

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
                            logger.debug(
                                f"Processed response for message {message_id}"
                            )
                    else:
                        message_summary = {
                            "id": response.get("id"),
                            "success": response.get("success"),
                            "has_result": "result" in response,
                            "result_type": type(
                                response.get("result")
                            ).__name__
                            if "result" in response
                            else None,
                        }
                        logger.debug(
                            f"Received unexpected message: {message_summary}"
                        )

                except asyncio.CancelledError:
                    disconnect_reason = "Receive loop cancelled"
                    pending_error = ConnectionError(
                        f"browser ws closed: {disconnect_reason}"
                    )
                    logger.info(f"WebSocket disconnect: {disconnect_reason}")
                    break
                except websockets.exceptions.ConnectionClosed as e:
                    disconnect_reason = (
                        f"WebSocket closed: code={e.code}, reason={e.reason}"
                    )
                    pending_error = ConnectionError(
                        f"browser ws closed: {disconnect_reason}"
                    )
                    logger.warning(
                        f"WebSocket disconnect: {disconnect_reason}"
                    )
                    break
                except websockets.exceptions.WebSocketException as e:
                    disconnect_reason = (
                        f"WebSocket error: {type(e).__name__}: {e}"
                    )
                    pending_error = ConnectionError(
                        f"browser ws closed: {disconnect_reason}"
                    )
                    logger.error(f"WebSocket disconnect: {disconnect_reason}")
                    break
                except json.JSONDecodeError as e:
                    logger.error(f"Failed to decode WebSocket message: {e}")
                    continue  # Try to continue on JSON errors
                except Exception as e:
                    disconnect_reason = (
                        f"Unexpected error: {type(e).__name__}: {e}"
                    )
                    pending_error = e
                    logger.error(
                        f"WebSocket disconnect: {disconnect_reason}",
                        exc_info=True,
                    )
                    break
        finally:
            logger.info(
                f"WebSocket receive loop terminated. Reason: {disconnect_reason or 'Normal shutdown'}"
            )
            self._fail_all_pending(
                pending_error
                or ConnectionError("browser ws receive loop ended")
            )
            # Mark the websocket as None to indicate disconnection
            self.websocket = None

    async def start(self):
        """Start CAMEL, adding the target guard only for Electron sessions."""
        self._ensure_local_no_proxy()
        logger.info(
            "Starting WebSocket server using parent implementation (system npm/node)"
        )
        owned_target_url = str(self.config.get("ownedTargetUrl") or "")
        if not owned_target_url:
            return await super().start()

        hook_path = Path(__file__).with_name("electron_target_guard.cjs")
        require_option = f"--require={hook_path}"
        async with _node_runtime_hook_lock:
            previous = os.environ.get("NODE_OPTIONS")
            options = previous.split() if previous else []
            if require_option not in options:
                options.append(require_option)
            os.environ["NODE_OPTIONS"] = " ".join(options)
            try:
                return await super().start()
            finally:
                if previous is None:
                    os.environ.pop("NODE_OPTIONS", None)
                else:
                    os.environ["NODE_OPTIONS"] = previous

    async def _send_command(
        self, command: str, params: dict[str, Any]
    ) -> dict[str, Any]:
        """Send a command to the WebSocket server with enhanced error handling."""
        try:
            # First ensure we have a valid connection
            if self.websocket is None:
                raise RuntimeError("WebSocket connection not established")

            # Check connection state before sending
            if hasattr(self.websocket, "state"):
                import websockets.protocol

                if self.websocket.state != websockets.protocol.State.OPEN:
                    raise RuntimeError(
                        f"WebSocket is in {self.websocket.state} state, not OPEN"
                    )

            logger.debug(f"Sending command '{command}' with params: {params}")

            timeout = self._command_timeout_seconds(command)

            # Call parent's _send_command with an outer timeout so cancelled
            # waits cannot leave pending futures stranded in this subclass.
            result = await asyncio.wait_for(
                super()._send_command(command, params), timeout=timeout
            )

            logger.debug(f"Command '{command}' completed successfully")
            return result

        except TimeoutError as e:
            message = (
                f"browser command '{command}' timed out after "
                f"{self._command_timeout_seconds(command)}s"
            )
            logger.error(message)
            self._fail_all_pending(TimeoutError(message))
            await self._close_current_websocket()
            raise RuntimeError(message) from e
        except RuntimeError as e:
            logger.error(f"Failed to send command '{command}': {e}")
            # Check if it's a connection issue
            lower_error = str(e).lower()
            if (
                "websocket" in lower_error
                or "connection" in lower_error
                or "timeout" in lower_error
                or "timed out" in lower_error
            ):
                # Mark connection as dead
                self._fail_all_pending(e)
                await self._close_current_websocket()
            raise
        except Exception as e:
            logger.error(
                f"Unexpected error sending command '{command}': {type(e).__name__}: {e}"
            )
            raise

    async def visit_page(self, url: str) -> dict[str, Any]:
        """Override visit_page to add global navigation lock preventing ERR_ABORTED.

        Multiple sessions sharing the same browser via CDP can cause conflicts
        when they try to navigate simultaneously (e.g., both trying to use a
        blank page). This lock serializes navigation operations at the WebSocket
        wrapper level.
        """
        lock_key = self._navigation_lock_key()
        lock = await _get_navigation_lock(lock_key)
        lock_wait = self._navigation_lock_wait_seconds()
        acquired = False
        try:
            await asyncio.wait_for(lock.acquire(), timeout=lock_wait)
            acquired = True
        except TimeoutError as exc:
            raise RuntimeError(
                "navigation lock busy; browser may be stuck "
                f"(key={lock_key}, waited={lock_wait}s)"
            ) from exc

        logger.debug(
            f"[visit_page] Acquired navigation lock ({lock_key}), navigating to {url}"
        )
        try:
            all_tabs = await super().get_tab_info()
            await self._track_and_limit_tabs(all_tabs, reserve_slots=1)
            result = await super().visit_page(url)
            logger.debug("[visit_page] Navigation completed, releasing lock")
            return result
        except Exception as e:
            logger.error(f"[visit_page] Navigation failed: {e}")
            raise
        finally:
            if acquired:
                lock.release()

    async def get_tab_info(self) -> list[dict[str, Any]]:
        """Override get_tab_info to track and filter tabs for session isolation.

        Automatically tracks the current tab (is_current=true) as belonging to
        this session, then filters to only return tabs owned by this session.
        Uses global registry to ensure each tab belongs to only one session.
        """
        global _global_tab_registry, _global_tab_registry_lock

        all_tabs = await super().get_tab_info()
        all_tabs = await self._track_and_limit_tabs(all_tabs)
        session_id = self._wrapper_session_id  # Stable UUID for this wrapper

        # Filter: only return tabs belonging to this session
        filtered_tabs = [
            tab
            for tab in all_tabs
            if tab.get("tab_id") in self._session_tab_ids
        ]
        logger.info(
            f"[Session Tab Filtering] Session {session_id}: Returning {len(filtered_tabs)}/{len(all_tabs)} tabs, tracked: {self._session_tab_ids}"
        )

        return filtered_tabs

    async def close_tab(self, tab_id: str) -> dict[str, Any]:
        """Override close_tab to update tracking."""
        global _global_tab_registry, _global_tab_registry_lock

        result = await super().close_tab(tab_id)

        # Remove from tracking if it was ours
        if tab_id in self._session_tab_ids:
            self._forget_session_tab(tab_id)
            async with _global_tab_registry_lock:
                key = self._tab_registry_key(tab_id)
                if _global_tab_registry.get(key) == self._wrapper_session_id:
                    del _global_tab_registry[key]
            logger.info(
                f"[Session Tab Tracking] Removed closed tab: {tab_id}, session now has tabs: {self._session_tab_ids}"
            )

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
                key = self._tab_registry_key(tab_id)
                if _global_tab_registry.get(key) == self._wrapper_session_id:
                    del _global_tab_registry[key]
            # Clear inside lock to prevent race with concurrent get_tab_info
            self._session_tab_ids.clear()
            self._session_tab_order.clear()
            logger.info(
                f"[Session Tab Tracking] Cleaned up {cleaned_count} tabs for session {self._wrapper_session_id}"
            )


# WebSocket connection pool
class WebSocketConnectionPool:
    """Manage WebSocket browser connections with session-based pooling."""

    def __init__(self):
        self._connections: dict[str, WebSocketBrowserWrapper] = {}
        self._lock = asyncio.Lock()

    async def get_connection(
        self, session_id: str, config: dict[str, Any]
    ) -> WebSocketBrowserWrapper:
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

                            is_healthy = (
                                wrapper.websocket.state
                                == websockets.protocol.State.OPEN
                            )
                            if not is_healthy:
                                logger.debug(
                                    f"Session {session_id} WebSocket state: {wrapper.websocket.state}"
                                )
                        elif hasattr(wrapper.websocket, "open"):
                            is_healthy = wrapper.websocket.open
                        else:
                            # Try ping as last resort
                            try:
                                await asyncio.wait_for(
                                    wrapper.websocket.ping(), timeout=1.0
                                )
                                is_healthy = True
                            except Exception:
                                is_healthy = False
                    except Exception as e:
                        logger.debug(
                            f"Health check failed for session {session_id}: {e}"
                        )
                        is_healthy = False

                if is_healthy:
                    logger.debug(
                        f"Reusing healthy WebSocket connection for session {session_id}"
                    )
                    return wrapper
                else:
                    # Connection is unhealthy, clean it up
                    logger.info(
                        f"Removing unhealthy WebSocket connection for session {session_id}"
                    )
                    try:
                        await wrapper.cleanup_tab_tracking()
                        await wrapper.stop()
                    except Exception as e:
                        logger.debug(f"Error stopping unhealthy wrapper: {e}")
                    del self._connections[session_id]

            # Create a new connection
            logger.info(
                f"Creating new WebSocket connection for session {session_id}"
            )
            wrapper = WebSocketBrowserWrapper(config)
            await wrapper.start()
            self._connections[session_id] = wrapper
            logger.info(
                f"Successfully created WebSocket connection for session {session_id}"
            )
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
                    logger.error(
                        f"Error closing WebSocket connection for session {session_id}: {e}"
                    )
                del self._connections[session_id]
                logger.info(
                    f"Closed WebSocket connection for session {session_id}"
                )

    async def _close_connection_unlocked(self, session_id: str):
        """Close connection without acquiring lock (for internal use)."""
        if session_id in self._connections:
            wrapper = self._connections[session_id]
            try:
                await wrapper.cleanup_tab_tracking()
                await wrapper.stop()
            except Exception as e:
                logger.error(
                    f"Error closing WebSocket connection for session {session_id}: {e}"
                )
            del self._connections[session_id]
            logger.info(
                f"Closed WebSocket connection for session {session_id}"
            )

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
        cache_dir: str | None = None,
        enabled_tools: list[str] | None = None,
        browser_log_to_file: bool = False,
        log_dir: str | None = None,
        session_id: str | None = None,
        default_start_url: str | None = None,
        default_timeout: int | None = None,
        short_timeout: int | None = None,
        navigation_timeout: int | None = None,
        network_idle_timeout: int | None = None,
        screenshot_timeout: int | None = None,
        page_stability_timeout: int | None = None,
        dom_content_loaded_timeout: int | None = None,
        viewport_limit: bool = False,
        connect_over_cdp: bool = True,  # Deprecated: auto-set to True when cdp_url is provided, kept for compatibility
        cdp_url: str | None = "http://localhost:9222",
        cdp_keep_current_page: bool = False,
        owned_target_url: str | None = None,
        full_visual_mode: bool = False,
    ) -> None:
        logger.info(
            f"[HybridBrowserToolkit] Initializing with api_task_id: {api_task_id}"
        )
        self.api_task_id = api_task_id
        logger.debug(
            f"[HybridBrowserToolkit] api_task_id set to: {self.api_task_id}"
        )

        # Set default user_data_dir if not provided
        if user_data_dir is None:
            # Use browser port to determine profile directory
            browser_port = env("browser_port", "9222")
            user_data_base = os.path.expanduser("~/.eigent/browser_profiles")
            user_data_dir = os.path.join(
                user_data_base, f"profile_{browser_port}"
            )
            os.makedirs(user_data_dir, exist_ok=True)
            logger.info(
                f"[HybridBrowserToolkit] Using port-based user_data_dir: {user_data_dir} (port: {browser_port})"
            )
        else:
            logger.info(
                f"[HybridBrowserToolkit] Using provided user_data_dir: {user_data_dir}"
            )

        logger.debug(
            f"[HybridBrowserToolkit] Calling super().__init__ with session_id: {session_id}"
        )
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
        self._owned_target_url = owned_target_url
        self._allow_owned_target_clone = False
        if owned_target_url:
            self._ws_config["ownedTargetUrl"] = owned_target_url
        if self._default_timeout is not None:
            self._ws_config["defaultTimeout"] = self._default_timeout
        command_timeout_override = env(
            "BROWSER_COMMAND_TIMEOUT_SECONDS", ""
        ).strip()
        if command_timeout_override:
            self._ws_config["requestTimeout"] = _timeout_value_to_seconds(
                command_timeout_override,
                fallback_seconds=60.0,
            )
        logger.info(
            f"[HybridBrowserToolkit] Initialization complete for api_task_id: {self.api_task_id}"
        )

    def _ws_cdp_url(self) -> str:
        return str(
            self._ws_config.get("cdpUrl")
            or self._ws_config.get("cdp_url")
            or f"http://localhost:{env('browser_port', '9222')}"
        )

    def _should_prime_shared_cdp_tab(self) -> bool:
        enabled = (
            env("EIGENT_INTERIM_SHARED_BROWSER_TAB_ISOLATION", "true")
            .strip()
            .lower()
        )
        if enabled in {"0", "false", "no", "off"}:
            return False
        return bool(
            self._ws_config.get("cdpUrl") or self._ws_config.get("cdp_url")
        ) and not bool(self._ws_config.get("cdpKeepCurrentPage"))

    async def _prime_shared_cdp_tab(self, session_id: str) -> None:
        if self._ws_wrapper is None:
            return
        # === INTERIM(shared-browser tab isolation) remove after camel upstream fix; see docs/REMOTE_CONTROL_SHARED_BROWSER_TAB_ISOLATION_2026-06-15.md ===
        sentinel_url = f"about:blank#eigent-{session_id}"
        logger.info(
            "[INTERIM shared-browser tab isolation] Priming session tab",
            extra={"session_id": session_id, "sentinel_url": sentinel_url},
        )
        await self._ws_wrapper.visit_page(sentinel_url)
        self._ws_wrapper._eigent_interim_shared_browser_primed = True

    async def _ensure_ws_wrapper(self):
        """Ensure WebSocket wrapper is initialized using connection pool."""
        logger.debug(
            f"[HybridBrowserToolkit] _ensure_ws_wrapper called for api_task_id: {getattr(self, 'api_task_id', 'NOT SET')}"
        )
        global websocket_connection_pool

        # Get session ID from config or use default
        session_id = self._ws_config.get("session_id", "default")
        logger.debug(f"[HybridBrowserToolkit] Using session_id: {session_id}")

        # Log when connecting to browser
        cdp_url = self._ws_cdp_url()
        logger.info(
            f"[PROJECT BROWSER] Connecting to browser via CDP at {cdp_url}"
        )

        should_prime = self._should_prime_shared_cdp_tab()
        bringup_lock: asyncio.Lock | None = None
        bringup_acquired = False
        if should_prime:
            bringup_lock = await _get_browser_bringup_lock(
                _endpoint_lock_key(cdp_url)
            )
            bringup_wait = _env_timeout_seconds(
                "BROWSER_BRINGUP_LOCK_TIMEOUT_SECONDS",
                fallback_seconds=45.0,
            )
            try:
                await asyncio.wait_for(
                    bringup_lock.acquire(), timeout=bringup_wait
                )
                bringup_acquired = True
            except TimeoutError as exc:
                raise RuntimeError(
                    "browser bring-up lock busy; shared browser may be stuck "
                    f"(endpoint={cdp_url}, waited={bringup_wait}s)"
                ) from exc

        try:
            # Get or create connection from pool
            self._ws_wrapper = await websocket_connection_pool.get_connection(
                session_id, self._ws_config
            )
            logger.info(
                f"[HybridBrowserToolkit] WebSocket wrapper initialized for session: {session_id}"
            )

            # Additional health check
            if self._ws_wrapper.websocket is None:
                logger.warning(
                    f"WebSocket connection for session {session_id} is None after pool retrieval, recreating..."
                )
                await websocket_connection_pool.close_connection(session_id)
                self._ws_wrapper = (
                    await websocket_connection_pool.get_connection(
                        session_id, self._ws_config
                    )
                )

            if should_prime and not getattr(
                self._ws_wrapper,
                "_eigent_interim_shared_browser_primed",
                False,
            ):
                await self._prime_shared_cdp_tab(session_id)
        finally:
            if bringup_acquired and bringup_lock is not None:
                bringup_lock.release()

    def clone_for_new_session(
        self, new_session_id: str | None = None
    ) -> "HybridBrowserToolkit":
        import uuid

        if self._owned_target_url and not self._allow_owned_target_clone:
            raise RuntimeError(
                "An Electron embedded Browser Toolkit target cannot be "
                "cloned until the CDP pool assigns a different target."
            )

        if new_session_id is None:
            new_session_id = str(uuid.uuid4())[:8]

        # For cloned sessions, use the same user_data_dir to share login state
        # This allows multiple agents to use the same browser profile without conflicts
        logger.info(
            f"Cloning session {new_session_id} with shared user_data_dir: {self._user_data_dir}"
        )

        # Use the same session_id to share the same browser instance
        # This ensures all clones use the same WebSocket connection and browser
        # When cdp_keep_current_page=True, default_start_url must be None (CAMEL constraint)
        cdp_keep = (
            self.config_loader.get_browser_config().cdp_keep_current_page
        )
        clone_start_url = None if cdp_keep else self._default_start_url

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
            default_start_url=clone_start_url,
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
            cdp_keep_current_page=self.config_loader.get_browser_config().cdp_keep_current_page,
            owned_target_url=self._owned_target_url,
            full_visual_mode=self._full_visual_mode,
        )

    async def browser_sheet_input(
        self, *, cells: list[SheetCell]
    ) -> dict[str, Any]:
        # Use typing_extensions.TypedDict for Pydantic <3.12 compatibility.
        return await super().browser_sheet_input(cells=cells)

    def get_tools(self):
        tools = super().get_tools()
        for tool in tools:
            if not getattr(tool.func, "__listen_toolkit__", False):
                cls_method = getattr(type(self), tool.func.__name__, None)
                if cls_method and getattr(
                    cls_method, "__listen_toolkit__", False
                ):
                    tool.func.__listen_toolkit__ = True
        return tools

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
            logger.debug(
                f"HybridBrowserToolkit for session {session_id} is being garbage collected"
            )
