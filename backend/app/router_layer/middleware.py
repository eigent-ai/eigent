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

"""Channel/Session header middleware for Phase 2 Message Router."""

import logging
import uuid

from app.component.environment import env
from app.router_layer.hands_resolver import get_hands_for_channel

logger = logging.getLogger("router_layer")

DEFAULT_CHANNEL = "desktop"
CHANNELS = frozenset(
    {
        "desktop",
        "web",
        "cli",
        "whatsapp",
        "telegram",
        "slack",
        "discord",
        "lark",
        "browser_extension",
    }
)


def _is_truthy(raw: str | None) -> bool:
    if raw is None:
        return False
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _get_header(
    scope: dict, name: str, default: str | None = None
) -> str | None:
    name_lower = name.lower().encode()
    for k, v in scope.get("headers", []):
        if k.lower() == name_lower:
            return v.decode() if v else default
    return default


class ChannelSessionMiddleware:
    """
    Parse X-Channel, X-Session-ID, X-User-ID headers and store in request.state.
    Add X-Session-ID to response for clients.
    Uses plain ASGI for reliable response header injection.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        channel = (
            _get_header(scope, "X-Channel", DEFAULT_CHANNEL) or DEFAULT_CHANNEL
        )
        if channel not in CHANNELS:
            logger.warning(
                "Invalid X-Channel header %r, falling back to %r",
                channel,
                DEFAULT_CHANNEL,
            )
            channel = DEFAULT_CHANNEL

        session_id = _get_header(scope, "X-Session-ID")
        user_id = _get_header(scope, "X-User-ID")
        hands_override = _get_header(scope, "X-Hands-Override")
        debug_override_enabled = _is_truthy(env("EIGENT_DEBUG", "false"))

        if hands_override and not debug_override_enabled:
            logger.warning(
                "Ignoring X-Hands-Override because EIGENT_DEBUG is disabled"
            )
            hands_override = None

        if not session_id:
            session_id = f"sess_{uuid.uuid4().hex[:16]}"

        hands = get_hands_for_channel(channel, hands_override)

        if "state" not in scope:
            scope["state"] = {}
        scope["state"]["channel"] = channel
        scope["state"]["session_id"] = session_id
        scope["state"]["user_id"] = user_id
        scope["state"]["hands_override"] = hands_override
        scope["state"]["hands"] = hands

        session_id_bytes = session_id.encode()

        async def send_wrapper(message):
            if message["type"] == "http.response.start" and session_id:
                headers = list(message.get("headers", []))
                if not any(h[0].lower() == b"x-session-id" for h in headers):
                    headers.append((b"x-session-id", session_id_bytes))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_wrapper)
