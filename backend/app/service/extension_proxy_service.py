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

"""Global singleton service managing ExtensionProxyWrapper lifecycle.

Start/stop the WebSocket server from the Extension settings page,
and provide the running wrapper instance to browser_agent().
"""

import asyncio
import logging

logger = logging.getLogger("extension_proxy_service")

_wrapper = None  # ExtensionProxyWrapper | None
_wrapper_status = "stopped"  # "stopped" | "waiting" | "connected"


async def start_extension_proxy(
    host: str = "localhost",
    port: int = 8765,
    model_config: dict | None = None,
) -> dict:
    """Start the WebSocket server and wait for extension connection.

    Args:
        host: WebSocket server host.
        port: WebSocket server port.
        model_config: LLM model config for extension chat.
            Keys: model_platform, model_type, api_key, api_url, extra_params
    """
    global _wrapper, _wrapper_status

    if _wrapper is not None:
        return {"status": get_status()}

    # Store model config for extension chat
    if model_config:
        from app.service.extension_chat_service import configure_model

        configure_model(model_config)

    from camel.toolkits.hybrid_browser_toolkit.extension_proxy_wrapper import (
        ExtensionProxyWrapper,
    )

    _wrapper = ExtensionProxyWrapper(config={}, host=host, port=port)
    await _wrapper.start()
    _wrapper_status = "waiting"
    logger.info(f"Extension proxy server started on ws://{host}:{port}")

    asyncio.create_task(_watch_connection())
    return {"status": "waiting"}


async def _watch_connection():
    """Background task: update status when extension connects, monitor for disconnection."""
    global _wrapper_status
    if _wrapper is None:
        return
    try:
        connected = await _wrapper.wait_for_connection(timeout=600.0)
        if connected:
            _wrapper_status = "connected"
            logger.info("Chrome extension connected to proxy")

            # Start chat loop for extension chat
            from app.service.extension_chat_service import start_chat_loop

            await start_chat_loop(_wrapper)

            # Monitor for disconnection
            while _wrapper is not None:
                await asyncio.sleep(2)
                if _wrapper is None:
                    break
                if _wrapper._client is None:
                    _wrapper_status = "waiting"
                    logger.warning(
                        "Chrome extension disconnected, "
                        "waiting for reconnection..."
                    )
                    # Wait for reconnection
                    try:
                        reconnected = await _wrapper.wait_for_connection(
                            timeout=600.0
                        )
                        if reconnected:
                            _wrapper_status = "connected"
                            logger.info(
                                "Chrome extension reconnected to proxy"
                            )
                        else:
                            logger.warning(
                                "Timed out waiting for extension reconnection"
                            )
                    except Exception as e:
                        logger.error(f"Error waiting for reconnection: {e}")
                        break
        else:
            logger.warning("Timed out waiting for extension connection")
    except Exception as e:
        logger.error(f"Error watching extension connection: {e}")


async def stop_extension_proxy() -> dict:
    """Stop the WebSocket server and clear the singleton."""
    global _wrapper, _wrapper_status

    # Stop chat loop first
    from app.service.extension_chat_service import stop_chat_loop

    await stop_chat_loop()

    if _wrapper is not None:
        try:
            await _wrapper.stop()
        except Exception as e:
            logger.error(f"Error stopping extension proxy: {e}")
        _wrapper = None
    _wrapper_status = "stopped"
    return {"status": "stopped"}


def get_extension_proxy_wrapper():
    """Get the running wrapper instance, or None."""
    return _wrapper


def get_status() -> str:
    """Get current status: stopped, waiting, or connected."""
    global _wrapper_status
    if _wrapper is None:
        _wrapper_status = "stopped"
    elif _wrapper._client is not None:
        _wrapper_status = "connected"
    elif _wrapper_status == "connected":
        # Was connected but client is gone now
        _wrapper_status = "waiting"
    return _wrapper_status
