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

"""Message Router HTTP endpoint for Phase 2."""

import inspect
import json
import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.router_layer.interface import InboundMessage
from app.router_layer.message_router import DefaultMessageRouter

router = APIRouter()
message_logger = logging.getLogger("message_controller")

# Singleton router instance
_message_router: DefaultMessageRouter | None = None


def get_message_router() -> DefaultMessageRouter:
    global _message_router
    if _message_router is None:
        _message_router = DefaultMessageRouter()
    return _message_router


@router.post("/messages", name="send message via router")
async def post_message(request: Request):
    """
    Accept message per docs/design/06-protocol.md §2.1.
    Uses X-Channel, X-Session-ID, X-User-ID from ChannelSessionMiddleware.
    Returns SSE stream for chat, or JSON for non-streaming.
    """
    body = (
        await request.json()
        if request.headers.get("content-type", "").startswith(
            "application/json"
        )
        else {}
    )
    if not isinstance(body, dict):
        body = {}

    channel = getattr(request.state, "channel", None) or "desktop"
    session_id = getattr(request.state, "session_id", None)
    user_id = getattr(request.state, "user_id", None)

    mr = get_message_router()
    resolved_session_id = await mr.resolve_session(
        channel, session_id, user_id
    )

    headers_dict = {}
    for k, v in request.headers.items():
        headers_dict[k] = v

    msg = InboundMessage(
        session_id=resolved_session_id,
        channel=channel,
        user_id=user_id,
        payload=body,
        headers=headers_dict,
    )

    result = mr.route_in(msg, request=request)

    if not inspect.isasyncgen(result):
        message_logger.error(
            "message_router.route_in returned non-stream result: %r",
            type(result),
        )
        return JSONResponse(
            {
                "code": -1,
                "text": "Internal router contract error",
                "data": {},
            },
            status_code=500,
            headers={"X-Session-ID": resolved_session_id},
        )

    async def stream():
        async for out in result:
            raw = out.payload.get("raw")
            if raw:
                yield raw
            elif not out.stream:
                # Non-streaming error: yield as SSE event
                yield f"data: {json.dumps(out.payload, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"X-Session-ID": resolved_session_id},
    )
