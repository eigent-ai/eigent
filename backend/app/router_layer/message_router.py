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

"""Default Message Router implementation for Phase 2."""

import logging
import os
import time
import uuid
from collections.abc import AsyncGenerator
from typing import TYPE_CHECKING

from app.router_layer.interface import (
    InboundMessage,
    IRouter,
    OutboundMessage,
)
from app.router_layer.session_store import ISessionStore, MemorySessionStore

if TYPE_CHECKING:
    from fastapi import Request

logger = logging.getLogger("router_layer")

# Session TTL: 24 hours per docs/design/06-protocol.md §1.2
SESSION_TTL_SECONDS = 86400


def _now_ts() -> float:
    return time.time()


class DefaultMessageRouter(IRouter):
    """
    Default Message Router with in-memory session store.
    Implements resolve_session per docs/design/06-protocol.md §1.5.
    """

    def __init__(
        self,
        session_ttl: int = SESSION_TTL_SECONDS,
        session_store: ISessionStore | None = None,
    ):
        self._session_ttl = session_ttl
        self._session_store: ISessionStore = (
            session_store or MemorySessionStore()
        )

    async def resolve_session(
        self,
        channel: str,
        session_id: str | None,
        user_id: str | None,
    ) -> str:
        """
        Resolve or create Session per docs/design/06-protocol.md §1.5.
        Uses channel isolation: same user_id on different channels get different sessions.
        """
        # 1. If session_id provided, check store
        if session_id:
            entry = await self._session_store.get(session_id)
            if (
                isinstance(entry, dict)
                and entry.get("channel") == channel
                and not self._is_expired(entry)
            ):
                entry["last_activity"] = _now_ts()
                await self._session_store.set(
                    session_id, entry, ttl=self._session_ttl
                )
                return session_id
            # Expired or not found → treat as new, fall through
            await self._session_store.delete(session_id)

        # 2. Generate new session_id
        new_id = f"sess_{uuid.uuid4().hex[:16]}"

        # 3. Channel isolation: always create new session (per §1.3 recommendation)
        now = _now_ts()
        entry = {
            "session_id": new_id,
            "channel": channel,
            "user_id": user_id,
            "created_at": now,
            "last_activity": now,
        }
        await self._session_store.set(new_id, entry, ttl=self._session_ttl)

        return new_id

    def _is_expired(self, entry: dict) -> bool:
        last_activity = entry.get("last_activity")
        if not isinstance(last_activity, (int, float)):
            return True
        return (_now_ts() - float(last_activity)) > self._session_ttl

    async def route_in(
        self,
        msg: InboundMessage,
        *,
        request: "Request | None" = None,
    ) -> AsyncGenerator[OutboundMessage, None]:
        """
        Inbound: dispatch to Core.
        For chat payload (content present), forwards to step_solve.
        request is required for chat dispatch (disconnect detection, hands).
        """
        payload = msg.payload
        content = payload.get("content") if isinstance(payload, dict) else None

        if content is not None and request is not None:
            # Chat message: build Chat and stream from step_solve
            async for out in self._route_chat(msg, request):
                yield out
        else:
            # Unknown or unsupported payload
            yield OutboundMessage(
                session_id=msg.session_id,
                payload={
                    "code": -1,
                    "text": "Unsupported message type or missing content",
                    "data": {},
                },
                stream=False,
            )

    async def _route_chat(
        self,
        msg: InboundMessage,
        request: "Request",
    ) -> AsyncGenerator[OutboundMessage, None]:
        """Dispatch chat payload to step_solve."""
        from app.controller.chat_controller import start_chat_stream
        from app.model.chat import Chat

        payload = msg.payload or {}
        project_id = payload.get("project_id") or msg.session_id
        task_id = payload.get("task_id") or str(uuid.uuid4())
        content = payload.get("content", "")
        attachments = payload.get("attachments") or []
        # Map design doc attachments [{type, file_id}] -> attaches (paths/ids)
        attaches = []
        for a in attachments:
            if isinstance(a, dict) and "file_id" in a:
                attaches.append(a["file_id"])
            elif isinstance(a, str):
                attaches.append(a)

        user_id = msg.user_id or "user"
        email = f"{user_id}@local" if "@" not in user_id else user_id

        # Build Chat with defaults
        chat = Chat(
            task_id=task_id,
            project_id=project_id,
            question=content,
            email=email,
            attaches=attaches,
            model_platform=payload.get("model_platform") or "openai",
            model_type=payload.get("model_type") or "gpt-4o",
            # TODO(multi-tenant): falling back to os.environ inherits whatever
            # the last /chat request wrote – unsafe under concurrent sessions.
            api_key=payload.get("api_key")
            or os.environ.get("OPENAI_API_KEY", ""),
            api_url=payload.get("api_url"),
            user_id=msg.user_id,
        )

        stream = await start_chat_stream(chat, request)
        async for sse_chunk in stream:
            yield OutboundMessage(
                session_id=msg.session_id,
                payload={"raw": sse_chunk},
                stream=True,
            )

    async def route_out(self, session_id: str, msg: OutboundMessage) -> None:
        """Outbound: route back to Client. Empty for now (WebSocket push later)."""
        pass
