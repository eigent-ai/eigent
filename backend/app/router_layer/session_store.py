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

import time
from abc import ABC, abstractmethod
from typing import Any


class ISessionStore(ABC):
    @abstractmethod
    async def get(self, session_id: str) -> dict[str, Any] | None: ...

    @abstractmethod
    async def set(
        self, session_id: str, entry: dict[str, Any], ttl: int = 86400
    ) -> None: ...

    @abstractmethod
    async def delete(self, session_id: str) -> None: ...


class MemorySessionStore(ISessionStore):
    _CLEANUP_INTERVAL_SET_CALLS = 128
    _CLEANUP_BATCH_SIZE = 512

    def __init__(self) -> None:
        self._sessions: dict[str, dict[str, Any]] = {}
        self._expires_at: dict[str, float] = {}
        self._set_calls = 0

    def _is_expired(self, session_id: str) -> bool:
        expires_at = self._expires_at.get(session_id)
        if expires_at is None:
            return False
        return time.time() > expires_at

    def _cleanup_if_expired(self, session_id: str) -> None:
        if self._is_expired(session_id):
            self._sessions.pop(session_id, None)
            self._expires_at.pop(session_id, None)

    def _cleanup_expired_entries(self, max_entries: int) -> None:
        if not self._expires_at:
            return
        now = time.time()
        cleaned = 0
        for session_id, expires_at in list(self._expires_at.items()):
            if expires_at > now:
                continue
            self._sessions.pop(session_id, None)
            self._expires_at.pop(session_id, None)
            cleaned += 1
            if cleaned >= max_entries:
                break

    async def get(self, session_id: str) -> dict[str, Any] | None:
        self._cleanup_if_expired(session_id)
        return self._sessions.get(session_id)

    async def set(
        self, session_id: str, entry: dict[str, Any], ttl: int = 86400
    ) -> None:
        self._set_calls += 1
        if (
            self._set_calls % self._CLEANUP_INTERVAL_SET_CALLS == 0
        ):  # lazy GC for never-read sessions
            self._cleanup_expired_entries(self._CLEANUP_BATCH_SIZE)
        self._sessions[session_id] = entry
        if ttl > 0:
            self._expires_at[session_id] = time.time() + ttl
        else:
            self._expires_at.pop(session_id, None)

    async def delete(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)
        self._expires_at.pop(session_id, None)
