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

"""IRouter interface and message types for Phase 2 Message Router."""

from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from fastapi import Request


@dataclass
class InboundMessage:
    """Standardized inbound message format."""

    session_id: str
    channel: str  # desktop | web | cli | whatsapp | telegram | slack | ...
    user_id: str | None
    payload: dict[str, Any]
    headers: dict[str, str]


@dataclass
class OutboundMessage:
    """Outbound message for routing back to Client."""

    session_id: str
    payload: dict[str, Any]
    stream: bool = False


class IRouter(ABC):
    """Message Router interface."""

    @abstractmethod
    def route_in(
        self,
        msg: InboundMessage,
        *,
        request: "Request | None" = None,
    ) -> AsyncGenerator[OutboundMessage, None]:
        """Inbound: dispatch to Core and return streaming outbound messages."""
        pass

    @abstractmethod
    async def route_out(self, session_id: str, msg: OutboundMessage) -> None:
        """Outbound: route back to Client (for WebSocket push)."""
        pass

    @abstractmethod
    async def resolve_session(
        self,
        channel: str,
        session_id: str | None,
        user_id: str | None,
    ) -> str:
        """Resolve or create Session, return session_id."""
        pass
